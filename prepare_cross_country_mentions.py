#!/usr/bin/env python3
"""
Build cross-country mention datasets for the longitudinal world visualization.

This script scans the global article corpus, counts how often articles from one
country mention other countries (by name, abbreviation, or alias), aggregates
per-country totals, and exports both parquet and JSON artifacts used by the
Deck.gl globe.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
import argparse
import json
import os
import re
import sys
import unicodedata
from typing import Iterable

import pandas as pd
import pyarrow.parquet as pq
import pycountry
from flashtext import KeywordProcessor
from tqdm import tqdm

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_INPUT = PROJECT_ROOT / "outputs/for_nov10workshop_global_results/classify/classify_all.parquet"
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "outputs/derived"
DEFAULT_JSON_PATH = Path(__file__).resolve().parent / "public" / "cross_country_mentions_by_year.json"


MANUAL_SYNONYMS: dict[str, list[str]] = {
    "CZ": ["czech republic"],
    "HK": ["hong kong", "hongkong"],
    "IR": ["iran", "islamic republic of iran"],
    "KR": ["south korea", "republic of korea"],
    "NL": ["holland", "the netherlands"],
    "SA": ["saudi arabia", "kingdom of saudi arabia", "ksa"],
    "SV": ["el salvador"],
    "TR": ["turkey", "republic of turkey", "republic of turkiye"],
    "TT": ["trinidad and tobago", "trinidad & tobago"],
    "TW": ["taiwan", "republic of china", "taiwan roc"],
    "TZ": ["tanzania", "united republic of tanzania"],
    "VE": ["venezuela", "bolivarian republic of venezuela"],
    "VN": ["vietnam", "viet nam"],
}

# Keywords to strictly exclude because they are common stopwords in major languages
# or highly ambiguous.
BLOCKED_KEYWORDS: set[str] = {
    # English stopwords / Common words
    "us", "it", "in", "an", "at", "as", "be", "by", "do", "go", "he", "if", "is", 
    "me", "my", "no", "of", "on", "or", "so", "to", "up", "we", "am", 
    
    # Common 3-letter ISO code collisions (CRITICAL for data quality)
    "can",  # Canada vs 'can'
    "and",  # Andorra vs 'and'
    "are",  # UAE vs 'are'
    "nor",  # Norway vs 'nor'
    "per",  # Peru vs 'per'
    "pan",  # Panama vs 'pan'
    "arm",  # Armenia vs 'arm'
    "jam",  # Jamaica vs 'jam'
    "man",  # Isle of Man vs 'man'
    "vat",  # Holy See vs 'vat'
    "gin",  # Guinea vs 'gin'
    "guy",  # Guyana vs 'guy'
    "lie",  # Liechtenstein vs 'lie'
    "sur",  # Suriname vs 'sur' (esp in Romance languages)
    "ton",  # Tonga vs 'ton'
    
    # Romance languages stopwords (un=a/one, eu=I, etc.)
    "un", "eu", "lo", "la", "el", "en", "et", "es",
    
    # Geographic ambiguities (Isle of Man, Jersey, Reunion are often just words)
    "jersey", "reunion", "christmas island", "ascension island"
}

# Whitelist of short aliases that are generally safe/distinct enough to keep
SAFE_SHORT_ALIASES: set[str] = {
    "uk", "nz", "hk", "uae", "usa", "prc", "roc", "drc", "car"
}

@dataclass(frozen=True)
class CountryAlias:
    country_code: str
    raw_alias: str
    normalized_alias: str
    kind: str


def normalize_text(value: str | None) -> str:
    """
    Normalize text for keyword matching across multiple scripts (Latin, Cyrillic, Arabic, etc.).
    
    Steps:
    1. NFKD normalization (decomposes characters).
    2. Strip combining diacritics (accents, vowel marks) to unify variations (e.g. 'café' -> 'cafe').
    3. Lowercase.
    4. Replace hyphens with spaces.
    5. Keep only word characters (letters/numbers from any script) and spaces/dots.
    """
    if not isinstance(value, str):
        return ""
        
    # 1. Decompose (e.g. 'é' -> 'e' + combining acute)
    text = unicodedata.normalize("NFKD", value)
    
    # 2. Strip combining characters (Category Mn/Mc/Me usually, checking combining class > 0)
    # This removes Latin accents, Hebrew/Arabic vowel points, etc.
    text = "".join(c for c in text if not unicodedata.combining(c))
    
    # 3. Lowercase
    text = text.lower()
    
    # 4. Separators
    text = text.replace("-", " ")
    
    # 5. Strip punctuation/symbols but keep letters/numbers from all scripts
    # \w matches [a-zA-Z0-9_] plus Unicode letters/ideographs.
    # We keep dots as they appear in acronyms (U.S.A.), though sometimes we might want to strip them.
    text = re.sub(r"[^\w\s\.]", " ", text)
    
    # 6. Collapse whitespace
    text = re.sub(r"\s+", " ", text).strip()
    return text


def parse_year(value) -> int | None:
    """Coerce the provided value into a reasonable calendar year."""

    if value is None:
        return None
    try:
        year_int = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return year_int if 1900 <= year_int <= 2100 else None


def build_alias_records(country_codes: Iterable[str]) -> list[CountryAlias]:
    aliases: list[CountryAlias] = []
    for code in country_codes:
        country = pycountry.countries.get(alpha_2=code)
        if country is None:
            continue
        candidates: list[tuple[str, str]] = [
            ("name", country.name),
            ("official", getattr(country, "official_name", "")),
            ("common", getattr(country, "common_name", "")),
            ("alpha3", country.alpha_3),
        ]
        candidates.extend(("manual", term) for term in MANUAL_SYNONYMS.get(code, []))
        for kind, term in candidates:
            if not term:
                continue
            normalized = normalize_text(term)
            if not normalized:
                continue
            aliases.append(CountryAlias(code, term, normalized, kind))
    seen = set()
    unique_aliases: list[CountryAlias] = []
    for alias in aliases:
        key = (alias.country_code, alias.normalized_alias)
        if key in seen:
            continue
        seen.add(key)
        unique_aliases.append(alias)
    return unique_aliases


def build_keyword_processor(alias_table: pd.DataFrame) -> KeywordProcessor:
    processor = KeywordProcessor(case_sensitive=False)
    for row in alias_table.itertuples():
        if row.normalized_alias in BLOCKED_KEYWORDS:
            continue
        processor.add_keyword(row.normalized_alias, row.country_code)
    return processor


def count_country_mentions(normalized_text: str, keyword_processor: KeywordProcessor) -> Counter[str]:
    if not normalized_text:
        return Counter()
    matches = keyword_processor.extract_keywords(normalized_text)
    return Counter(matches)


def load_cldr_data() -> tuple[dict[str, list[str]], dict[str, dict[str, str]]]:
    """
    Load CLDR data to map countries to languages and languages to country names.
    Returns:
        country_to_langs: Map from country code (e.g. 'FR') to list of languages (e.g. ['fr', 'en']).
        lang_to_names: Map from language (e.g. 'fr') to dict of {TargetCountryCode: Name}.
    """
    print("Loading CLDR data...")
    country_to_langs: dict[str, list[str]] = {}
    lang_to_names: dict[str, dict[str, str]] = {}
    
    # Path to cldr-core within cldr directory
    territory_info_path = PROJECT_ROOT / "cldr/cldr-core/supplemental/territoryInfo.json"
    if not territory_info_path.exists():
        # Fallback to checking root if cldr folder structure varies
        territory_info_path = PROJECT_ROOT / "cldr-core/supplemental/territoryInfo.json"
        
    if not territory_info_path.exists():
        print(f"Warning: CLDR data not found at {territory_info_path}. Using defaults.")
        return {}, {}
        
    with open(territory_info_path, 'r') as f:
        t_info = json.load(f)
        
    territory_info = t_info.get("supplemental", {}).get("territoryInfo", {})
    
    for country_code, info in territory_info.items():
        langs = info.get("languagePopulation", {})
        if not langs:
            continue
            
        selected_langs = []
        for lang_code, lang_data in langs.items():
            status = lang_data.get("_officialStatus")
            pop_str = lang_data.get("_populationPercent", "0")
            try:
                pop = float(pop_str)
            except ValueError:
                pop = 0.0
                
            # Criteria: Official status OR significant population (>5%)
            if status in ("official", "de_facto_official", "official_regional") or pop >= 5.0:
                # Normalize lang code: replace '_' with '-' to match directory names
                norm_lang = lang_code.replace('_', '-')
                selected_langs.append((pop, norm_lang))
        
        # If no languages selected (rare), take the most populous one
        if not selected_langs:
            best_lang = None
            max_pop = -1.0
            for lang_code, lang_data in langs.items():
                pop_str = lang_data.get("_populationPercent", "0")
                try:
                    pop = float(pop_str)
                except ValueError:
                    pop = 0.0
                if pop > max_pop:
                    max_pop = pop
                    best_lang = lang_code
            if best_lang:
                selected_langs.append((max_pop, best_lang.replace('_', '-')))

        # Sort by population desc
        selected_langs.sort(key=lambda x: x[0], reverse=True)
        country_to_langs[country_code] = [lang for _, lang in selected_langs]
            
    # Collect all unique languages needed
    unique_langs = set()
    for langs in country_to_langs.values():
        unique_langs.update(langs)
        
    print(f"Mapped {len(country_to_langs)} countries to {len(unique_langs)} unique languages.")
    
    # Load names for each language
    locales_dir = PROJECT_ROOT / "cldr/cldr-localenames-full/main"
    if not locales_dir.exists():
         locales_dir = PROJECT_ROOT / "cldr-localenames-full/main"
         
    if not locales_dir.exists():
         print(f"Warning: CLDR locales not found at {locales_dir}")
         return country_to_langs, {}
         
    avail_langs = set(os.listdir(locales_dir))
    
    for lang in unique_langs:
        # Try exact match first
        target_lang = lang
        if target_lang not in avail_langs:
            # Try base lang (fr-BE -> fr) if exact not found
            if '-' in target_lang:
                base = target_lang.split('-')[0]
                if base in avail_langs:
                    target_lang = base
                else:
                    # Try finding any variant? e.g. if 'uz-Arab' requested but only 'uz' exists (unlikely, usually other way around)
                    # or if 'en' requested but only 'en-US' exists (also unlikely)
                    continue
            else:
                continue
        
        # Avoid reloading if we mapped multiple requests to same base lang
        if target_lang in lang_to_names:
            # Store the alias pointer? 
            # Ideally lang_to_names keys should match what's in country_to_langs values
            # So if we mapped 'fr-BE' -> 'fr', we should store lang_to_names['fr-BE'] = data_from_fr
            lang_to_names[lang] = lang_to_names[target_lang]
            continue

        path = locales_dir / target_lang / "territories.json"
        if not path.exists():
            continue
            
        try:
            with open(path, 'r') as f:
                data = json.load(f)
            main_data = data.get("main", {})
            if not main_data:
                continue
            # Key is usually the lang code
            inner_key = list(main_data.keys())[0]
            territories = main_data[inner_key].get("localeDisplayNames", {}).get("territories", {})
            if territories:
                lang_to_names[lang] = territories
                # Also store under the target_lang key if different
                if target_lang != lang:
                    lang_to_names[target_lang] = territories
        except Exception as e:
            print(f"Error loading CLDR for {lang}: {e}")
            
    print(f"Loaded CLDR names for {len(lang_to_names)} languages.")
    return country_to_langs, lang_to_names


def get_universal_aliases(country_codes: Iterable[str]) -> list[tuple[str, str]]:
    """
    Get universal aliases like Alpha-3 codes that apply across all languages.
    Returns list of (alias, country_code).
    """
    aliases = []
    for code in country_codes:
        country = pycountry.countries.get(alpha_2=code)
        if country is None:
            continue
        if hasattr(country, "alpha_3"):
            aliases.append((country.alpha_3, code))
    return aliases


def build_country_processors(
    country_codes: list[str],
    country_to_langs: dict[str, list[str]],
    lang_to_names: dict[str, dict[str, str]],
    default_keyword_processor: KeywordProcessor,
) -> dict[str, KeywordProcessor]:
    print("Pre-computing keyword processors for all source countries...")
    
    universal_aliases = get_universal_aliases(country_codes)
    
    # Cache processors by language-signature to save memory/time
    signature_to_processor: dict[tuple[str, ...], KeywordProcessor] = {}
    country_processors: dict[str, KeywordProcessor] = {}
    
    for source in tqdm(country_codes, desc="Building processors"):
        langs = country_to_langs.get(source, [])
        sig = tuple(langs)
        
        if sig in signature_to_processor:
            country_processors[source] = signature_to_processor[sig]
            continue
            
        # If no langs, use default (which has English + Universal + Manual)
        if not langs:
            country_processors[source] = default_keyword_processor
            signature_to_processor[sig] = default_keyword_processor
            continue
            
        kp = KeywordProcessor(case_sensitive=False)
        
        # 1. Universal
        for alias, code in universal_aliases:
            # Alpha-3 codes are usually 3 chars and safe, but check blocklist anyway
            if alias.lower() not in BLOCKED_KEYWORDS:
                kp.add_keyword(alias, code)
        
        # 2. Manual
        for code, synonyms in MANUAL_SYNONYMS.items():
            for syn in synonyms:
                if syn.lower() not in BLOCKED_KEYWORDS:
                    kp.add_keyword(syn, code)
        
        # 3. CLDR
        langs_processed = 0
        for lang in langs:
            if lang in lang_to_names:
                langs_processed += 1
                for key, name in lang_to_names[lang].items():
                     if "-alt-" in key:
                        code = key.split("-")[0]
                     else:
                        code = key
                    
                     if len(code) == 2: 
                         norm = normalize_text(name)
                         if not norm:
                             continue
                             
                         # CRITICAL: Filter short/stopword aliases
                         if len(norm) < 2:
                             continue
                         if len(norm) == 2 and norm not in SAFE_SHORT_ALIASES:
                             continue
                         if norm in BLOCKED_KEYWORDS:
                             continue
                             
                         kp.add_keyword(norm, code)
                         
        # 4. ALWAYS Include English/Default Names (Lingua Franca fallback)
        # This ensures that even if we are processing Russian articles, "USA" or "Germany" (in English) matches.
        # We extract keywords from the default processor (which contains English CLDR + Universal + Manual)
        default_keywords = default_keyword_processor.get_all_keywords()
        for alias, code in default_keywords.items():
            # Deduplication is handled by flashtext (overwrite or ignore? add_keyword overwrites by default)
            kp.add_keyword(alias, code)

        if langs_processed == 0:
             # If no native languages found, we are effectively just using the English set we just added.
             # To match the caching logic, we can just return the specific kp (which is now English-enriched).
             pass
        
        country_processors[source] = kp
        signature_to_processor[sig] = kp
             
    return country_processors


def export_dictionary_csv(country_processors: dict[str, KeywordProcessor], output_path: Path) -> None:
    """Exports the full dictionary of (source_country, alias, target_country) to CSV."""
    print(f"Exporting mention dictionary to {output_path}...")
    records = []
    for source_country, processor in tqdm(country_processors.items(), desc="Exporting dictionary"):
        # get_all_keywords() returns {normalized_alias: clean_name (target_code)}
        # Note: flashtext 2.7 returns a dict.
        all_keywords = processor.get_all_keywords()
        for alias, target_code in all_keywords.items():
             records.append({
                 "source_country": source_country,
                 "alias": alias,
                 "target_country": target_code
             })
             
    if not records:
        print("Warning: Dictionary is empty!")
        return

    df = pd.DataFrame(records)
    df.to_csv(output_path, index=False)
    print(f"✓ Saved dictionary with {len(df)} entries to {output_path}")


def aggregate_mentions(
    data_path: Path,
    country_processors: dict[str, KeywordProcessor],
    country_names: dict[str, str],
    debug_fraction: float | None = None,
    random_seed: int = 42,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    pf = pq.ParquetFile(data_path)
    country_series = (
        pq.read_table(data_path, columns=["country"]).to_pandas()["country"].dropna().str.upper()
    )
    country_codes = sorted(country_series.unique().tolist())
    country_set = set(country_codes)
    
    occurrence_counts: dict[str, Counter[str]] = defaultdict(Counter)
    article_hit_counts: dict[str, Counter[str]] = defaultdict(Counter)
    occurrence_counts_by_year: dict[str, dict[int, Counter[str]]] = defaultdict(lambda: defaultdict(Counter))
    article_hit_counts_by_year: dict[str, dict[int, Counter[str]]] = defaultdict(lambda: defaultdict(Counter))
    articles_seen: Counter[str] = Counter()
    articles_with_foreign_mentions: Counter[str] = Counter()
    articles_seen_by_year: dict[str, Counter[int]] = defaultdict(Counter)
    articles_with_foreign_mentions_by_year: dict[str, Counter[int]] = defaultdict(Counter)

    if debug_fraction is not None and not (0 < debug_fraction <= 1):
        raise ValueError("debug_fraction must be in (0, 1].")

    progress = tqdm(total=pf.metadata.num_rows, desc="Scanning articles", unit="articles")
    for batch in pf.iter_batches(columns=["country", "article_text", "year"], batch_size=1000):
        df_batch = batch.to_pandas().dropna(subset=["country", "article_text"])
        if df_batch.empty:
            continue
        df_batch["country"] = df_batch["country"].str.upper()
        df_batch = df_batch[df_batch["country"].isin(country_set)]
        if df_batch.empty:
            continue
        raw_batch_len = len(df_batch)
        if debug_fraction is not None:
            df_batch = df_batch.sample(frac=debug_fraction, random_state=random_seed)
            if df_batch.empty:
                progress.update(raw_batch_len)
                continue
        progress.update(raw_batch_len)
        for row in df_batch.itertuples(index=False):
            source = row.country
            articles_seen[source] += 1
            year_value = parse_year(getattr(row, "year", None))
            if year_value is not None:
                articles_seen_by_year[source][year_value] += 1

            normalized = normalize_text(row.article_text)
            
            # Select processor based on source country
            processor = country_processors.get(source)
            if not processor:
                # Should not happen if country_processors built correctly for all codes
                continue
            
            mention_counts = count_country_mentions(normalized, processor)
            mention_counts.pop(source, None)
            if not mention_counts:
                continue
            articles_with_foreign_mentions[source] += 1
            if year_value is not None:
                articles_with_foreign_mentions_by_year[source][year_value] += 1
            for target, count in mention_counts.items():
                occurrence_counts[source][target] += int(count)
                article_hit_counts[source][target] += 1
                if year_value is not None:
                    occurrence_counts_by_year[source][year_value][target] += int(count)
                    article_hit_counts_by_year[source][year_value][target] += 1
    progress.close()

    def build_mentions_df() -> pd.DataFrame:
        records: list[dict[str, object]] = []
        for source, target_counts in occurrence_counts.items():
            for target, occurrences in target_counts.items():
                records.append(
                    {
                        "source_country": source,
                        "mentioned_country": target,
                        "mention_occurrences": int(occurrences),
                        "article_hits": int(article_hit_counts[source][target]),
                    }
                )
        df = pd.DataFrame(records)
        if df.empty:
            raise RuntimeError("No cross-country mentions detected.")
        df["source_total_mentions"] = df.groupby("source_country")["mention_occurrences"].transform("sum")
        df["mention_share"] = df["mention_occurrences"] / df["source_total_mentions"].replace({0: pd.NA})
        df["source_articles_seen"] = df["source_country"].map(articles_seen)
        df["source_articles_with_foreign_mentions"] = df["source_country"].map(articles_with_foreign_mentions)
        df["article_hit_share"] = df["article_hits"] / df["source_articles_seen"].replace({0: pd.NA})
        df["source_country_name"] = df["source_country"].map(country_names)
        df["mentioned_country_name"] = df["mentioned_country"].map(country_names)
        return df.sort_values(["source_country", "mention_occurrences"], ascending=[True, False]).reset_index(drop=True)

    def build_mentions_by_year_df() -> pd.DataFrame:
        records: list[dict[str, object]] = []
        for source, year_counts in occurrence_counts_by_year.items():
            for year_value, target_counts in year_counts.items():
                for target, occurrences in target_counts.items():
                    records.append(
                        {
                            "year": year_value,
                            "source_country": source,
                            "mentioned_country": target,
                            "mention_occurrences": int(occurrences),
                            "article_hits": int(article_hit_counts_by_year[source][year_value][target]),
                        }
                    )
        df = pd.DataFrame(records)
        if df.empty:
            raise RuntimeError("No year-level cross-country mentions detected.")
        df["source_year_total_mentions"] = (
            df.groupby(["year", "source_country"])["mention_occurrences"].transform("sum")
        )
        df["mention_share"] = df["mention_occurrences"] / df["source_year_total_mentions"].replace({0: pd.NA})
        df["source_year_articles_seen"] = [
            articles_seen_by_year[source].get(year, 0)
            for source, year in zip(df["source_country"], df["year"])
        ]
        df["source_year_articles_with_foreign_mentions"] = [
            articles_with_foreign_mentions_by_year[source].get(year, 0)
            for source, year in zip(df["source_country"], df["year"])
        ]
        df["article_hit_share"] = df["article_hits"] / df["source_year_articles_seen"].replace({0: pd.NA})
        df["source_country_name"] = df["source_country"].map(country_names)
        df["mentioned_country_name"] = df["mentioned_country"].map(country_names)
        return df.sort_values(["year", "source_country", "mention_occurrences"], ascending=[True, True, False]).reset_index(
            drop=True
        )

    return build_mentions_df(), build_mentions_by_year_df()


def export_arc_json(mentions_by_year_df: pd.DataFrame, json_path: Path) -> None:
    arc_columns = [
        "year",
        "source_country",
        "source_country_name",
        "mentioned_country",
        "mentioned_country_name",
        "mention_occurrences",
        "mention_share",
        "article_hits",
        "article_hit_share",
        "source_year_total_mentions",
        "source_year_articles_seen",
    ]
    json_path.parent.mkdir(parents=True, exist_ok=True)
    mentions_by_year_df[arc_columns].to_json(json_path, orient="records")


def prepare_data(
    input_path: Path,
    output_dir: Path,
    json_path: Path,
    debug_fraction: float | None = None,
    random_seed: int = 42,
) -> None:
    print(f"Loading dataset metadata from {input_path}...")
    country_series = pq.read_table(input_path, columns=["country"]).to_pandas()["country"].dropna().str.upper()
    country_codes = sorted(country_series.unique().tolist())
    country_names = {code: pycountry.countries.get(alpha_2=code).name for code in country_codes}

    # Load CLDR data for better name matching
    country_to_langs, lang_to_names = load_cldr_data()

    # Build fallback/English processor
    alias_df = pd.DataFrame(
        [
            {"country_code": alias.country_code, "raw_alias": alias.raw_alias, "normalized_alias": alias.normalized_alias}
            for alias in build_alias_records(country_codes)
        ]
    )
    print(f"Prepared {len(alias_df)} default (English) aliases across {len(country_codes)} source countries.")

    default_keyword_processor = build_keyword_processor(alias_df)

    # Pre-compute processors per country
    country_processors = build_country_processors(
        country_codes=country_codes,
        country_to_langs=country_to_langs,
        lang_to_names=lang_to_names,
        default_keyword_processor=default_keyword_processor,
    )
    
    # Export dictionary
    output_dir.mkdir(parents=True, exist_ok=True)
    dictionary_csv_path = output_dir / "country_mention_dictionary.csv"
    export_dictionary_csv(country_processors, dictionary_csv_path)

    mentions_df, mentions_by_year_df = aggregate_mentions(
        data_path=input_path,
        country_processors=country_processors,
        country_names=country_names,
        debug_fraction=debug_fraction,
        random_seed=random_seed,
    )

    output_dir.mkdir(parents=True, exist_ok=True)
    output_parquet = output_dir / "cross_country_mentions.parquet"
    output_by_year_parquet = output_dir / "cross_country_mentions_by_year.parquet"

    mentions_df.to_parquet(output_parquet, index=False)
    mentions_by_year_df.to_parquet(output_by_year_parquet, index=False)
    export_arc_json(mentions_by_year_df, json_path)

    print(f"✓ Saved aggregate mentions to {output_parquet}")
    print(f"✓ Saved year-level mentions to {output_by_year_parquet}")
    print(f"✓ Exported arc JSON to {json_path} ({json_path.stat().st_size / 1024:.1f} KB)")
    print("Top source-target pairs:")
    print(
        mentions_df.sort_values("mention_occurrences", ascending=False)
        .head(10)[["source_country", "mentioned_country", "mention_occurrences", "mention_share"]]
        .to_string(index=False)
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare cross-country mention datasets for the UAIR globe.")
    parser.add_argument(
        "--input",
        type=Path,
        default=DEFAULT_INPUT,
        help=f"Path to the global article parquet file (default: {DEFAULT_INPUT})",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"Directory for parquet outputs (default: {DEFAULT_OUTPUT_DIR})",
    )
    parser.add_argument(
        "--json-path",
        type=Path,
        default=DEFAULT_JSON_PATH,
        help=f"Path for the arc JSON consumed by the visualization (default: {DEFAULT_JSON_PATH})",
    )
    parser.add_argument(
        "--debug-fraction",
        type=float,
        default=None,
        help="Optional sampling fraction (0-1] to speed up local debugging.",
    )
    parser.add_argument(
        "--random-seed",
        type=int,
        default=42,
        help="Random seed used when debug sampling is enabled.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        prepare_data(
            input_path=args.input,
            output_dir=args.output_dir,
            json_path=args.json_path,
            debug_fraction=args.debug_fraction,
            random_seed=args.random_seed,
        )
    except KeyboardInterrupt:
        print("Interrupted.", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
