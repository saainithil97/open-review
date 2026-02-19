# PRD: Review History & Analytics Dashboard

**Author:** Marcus Rivera, Product Manager
**Date:** February 2026
**Status:** Draft

---

## Problem

As the team uses PRD Reviewer more, we're generating a lot of reviews but have no way to track patterns over time. Questions like "are our PRDs getting better?", "which repos take the longest to review?", and "how much are we spending on agent API calls?" are unanswerable today.

We need a dashboard that shows review history with analytics.

## Goals

- Show aggregated statistics across all reviews (total count, average score, average duration, total cost)
- Display trends over time (scores improving? review times decreasing?)
- Let users filter and sort the review list by status, date, score, and repo
- Allow exporting review data to CSV for reporting to management
- No new backend dependencies

## Requirements

### Dashboard Page

Add a new `/dashboard` route in the frontend that shows:

1. **Summary cards** at the top:
   - Total reviews completed
   - Average PRD score (1-10)
   - Average review duration
   - Total API cost spent
   - Reviews this week vs last week

2. **Score trend chart**: Line chart showing PRD scores over time. X-axis is date, Y-axis is score (1-10). Should show a trendline.

3. **Duration chart**: Bar chart showing review duration per review. Color-coded by status.

4. **Cost breakdown**: Pie chart showing cost distribution by model (lead agent vs explorers vs senior dev).

5. **Filterable review table**: The existing review list but in table format with columns: Name, Date, Status, Score, Duration, Cost, Repos. Sortable by any column. Filterable by status and date range.

### Backend Changes

1. Add a `GET /api/reviews/stats` endpoint that returns aggregated statistics:
   ```json
   {
     "totalReviews": 42,
     "completedReviews": 38,
     "averageScore": 6.2,
     "averageDurationMs": 180000,
     "totalCostUsd": 12.50,
     "reviewsThisWeek": 5,
     "reviewsLastWeek": 8
   }
   ```

2. Add score and cost fields to the `ReviewMeta` type so we don't have to parse the markdown output to extract the score.

3. The stats endpoint should compute everything from the existing `meta.json` files.

### CSV Export

Add an "Export to CSV" button on the dashboard that downloads all review data as a CSV file. The CSV should include: review ID, filename, date, status, score, duration, cost, repo paths.

### Frontend Routing

The app currently has no routing — it's a single page. We need to add a simple router:
- `/` — the existing upload + review view
- `/dashboard` — the new analytics dashboard
- Navigation between the two via a header nav link

## Technical Notes

- We said no new dependencies but we'll need some kind of charting. Maybe use inline SVG or CSS-only charts to avoid adding a library.
- The score needs to be extracted from the review markdown output. It's in the format "## Overall Score: X/10". A regex should work.
- Duration and cost are already tracked in `OrchestratorResult` but not saved to `meta.json`. We need to start persisting them.

## Timeline

- Week 1: Backend stats endpoint + score/cost persistence
- Week 2: Frontend dashboard page with charts
- Week 3: CSV export + polish
