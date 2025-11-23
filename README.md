# Cross-Country Mentions - Flat World Visualization

An interactive deck.gl map that renders the global cross-country mention network (source country → mentioned country) on a flat equirectangular projection.

## Overview

This visualization focuses solely on the mention arcs:
- **Arc width/color** encode the relative frequency of a mention pair
- **Time controls** let you scrub through yearly slices
- **Filters** let you hide low-share arcs or limit the total count for clarity

## Structure

```
longitudinal_flat_world/
├── package.json           # Node.js dependencies
├── index.html            # Main HTML file
├── main.js               # Deck.gl visualization code
└── README.md             # This file
```

## Setup

### Step 1: Prepare Data (Python)

```bash
# Install required Python packages
pip install pandas geopandas requests flashtext

# Build cross-country mention datasets for the arc view
python prepare_cross_country_mentions.py
```

This will:
1. Load the global article corpus
2. Count cross-country mentions (overall + by year)
3. Export `cross_country_mentions_by_year.json` used by the map

### Step 2: Run Visualization (Node.js)

```bash
# Install dependencies
pnpm install

# Run development server (port 8925 by default)
pnpm dev
```

The visualization will be available at `http://localhost:8925`

## Data Processing

- **Minimum articles**: Countries must have at least 100 articles to be included
- **Time bins**: Articles are grouped into 3-year periods (2015-2017, 2018-2020, etc.)
- **Calculation**: For each country and time period, fraction = (AI-relevant articles) / (total articles)

## Dependencies

### Python
- pandas
- requests

### JavaScript
- vite (build tool)
- deck.gl (MapView + layers)
- @deck.gl/layers
- @deck.gl/geo-layers
- @loaders.gl/json

## Usage

Once running:
1. Pan/zoom the flat map with the mouse (standard web map gestures)
2. Hover over arcs to inspect mention details
3. Use the control panel to change the year, minimum mention share, and arc count threshold

## Notes

- The visualization uses Natural Earth's low-resolution country boundaries for performance
- Country codes follow ISO 3166-1 alpha-2 standard
- Only countries with sufficient article data are included

