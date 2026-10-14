# Missile Tracker

**How many missiles does the U.S. have left?** A source-linked tracker of U.S. missile and interceptor stockpiles after the 2026 Iran war, with an interactive model of how long the rebuild takes.

Real inventories are classified, so every number on the site is an estimate or a report. Each one is tied to the document it came from, and its exact quote is checked against that document by machine.

## What's tracked

| Air & missile defense | Long-range strike |
| --- | --- |
| Patriot (PAC-3 / MSE), THAAD, SM-3, SM-6 | Tomahawk, JASSM, PrSM |

These are the seven munitions in CSIS's [*Last Rounds?*](https://csis-website-prod.s3.amazonaws.com/s3fs-public/2026-04/260424_Cancian_Park_Last_Rounds.pdf?VersionId=JbVbjtv2ywN4avgN_9KSGw.kbdz8Ettl) analysis.

## How it fits together

```
data/
  munitions.json        what each missile is + sourced model inputs (cost, delivery rates, FY27 buy)
  reports/*.json        one file per source document, holding its claims and verbatim quotes
src/lib/
  schema.ts             zod schema for both files (the validator and the pipeline share it)
  model.ts              headline selection + the day-by-day rebuild projection
src/pages/              Astro static site: home, /missiles/<id>/, /methodology/
scripts/
  validate-data.ts      schema + cross-reference checks; --quotes fetches sources and checks quotes
  pipeline/watch.ts     daily: feeds → Claude drafts claims → quote check → pull request
  pipeline/add.ts       add one source by hand (paywalled stories, things the watcher missed)
```

**Headline rule.** Each missile's big number is the newest stock-left figure that doesn't mix sources: a direct "N left", or prewar minus used when one document gives both. Reporting that can't be converted, like CNN's "nearly 80%" of an undisclosed baseline, is shown beside the headline as *Newer reporting*. The full rules are on the [methodology page](src/pages/methodology.astro).

## Commands

```sh
npm install
npm run dev                         # local site at http://localhost:4321
npm test                            # model + pipeline tests
npm run validate                    # check data (offline)
npm run validate -- --quotes        # also confirm every quote on its source page
npm run build                       # validate + build to dist/
```

## Keeping the data current

### Automatic: the daily watch

`.github/workflows/watch-sources.yml` runs once a day:

1. Pulls candidates from CSIS (the Cancian and Park author pages), the GDELT news index, the NYT Article Search API (if keyed), and Bing News (if enabled). GDELT rate-limits GitHub's runners heavily, so in practice NYT and Bing do most of the news finding.
2. Keeps items that mention a tracked missile *and* stockpile language.
3. Sends each article to Claude Haiku 5.5 (`claude-haiku-5-5`, structured output) to draft claims with verbatim quotes. Roughly $0.001–0.002 per article.
4. Throws out any claim whose quote isn't on the page word for word, or that fails the schema.
5. Opens a pull request with the drafts and a summary.

A person merges the pull request. Nothing reaches the site without that review.

**Setup** (repo Settings → Secrets and variables → Actions):

| Name | Kind | Needed? |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | secret | Required for drafting |
| `NYT_API_KEY` | secret | Optional. Free key from developer.nytimes.com. NYT pages are paywalled, so these drafts use the abstract and are flagged for a manual quote check |
| `USE_BING_NEWS` | variable | Optional, set to `1`. Adds Bing News RSS, which catches more trade press than GDELT. Bing's terms limit the feed to personal, non-commercial use, so it's off by default |

Run it locally without spending API credits: `npm run watch-sources -- --dry-run`.

### By hand

```sh
npm run add-source -- https://www.example.com/story --outlet "Example" --published 2026-10-12
# paywalled? paste the text into a file:
npm run add-source -- https://www.nytimes.com/... --outlet "The New York Times" --title "..." --published 2026-10-12 --text-file story.txt
```

Or write a JSON file in `data/reports/` yourself, following the existing ones. `npm run validate -- --quotes` tells you if a quote doesn't match.

## Deploying

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main`, and once a day so the projections' "today" line stays current. Enable Pages under Settings → Pages → Source: GitHub Actions.

For a custom domain, set the repository variables `SITE_URL` (for example `https://missiletracker.us`) and `BASE_PATH=/`, add a `public/CNAME` file containing the domain, and point the domain's DNS at GitHub Pages.

## Corrections

Open an issue with the source link. Every number traces back to a file in `data/reports/`, so fixes are one-file pull requests.
