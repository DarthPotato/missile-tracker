# Missile Tracker

**How many missiles does the U.S. have left?** A source-linked tracker of U.S. missile and interceptor stockpiles after the 2026 Iran war, with an interactive model of how long the rebuild takes.

Real inventories are classified, so every number on the site is an estimate or a report. Each one is tied to the document it came from, and its exact quote is checked against that document by machine.

## What's tracked

| Air & missile defense                    | Long-range strike     |
| ---------------------------------------- | --------------------- |
| Patriot (PAC-3 / MSE), THAAD, SM-3, SM-6 | Tomahawk, JASSM, PrSM |

These are the seven munitions in CSIS's [_Last Rounds?_](https://csis-website-prod.s3.amazonaws.com/s3fs-public/2026-04/260424_Cancian_Park_Last_Rounds.pdf?VersionId=JbVbjtv2ywN4avgN_9KSGw.kbdz8Ettl) analysis.

## How it fits together

```
data/
  munitions.json        what each missile is + sourced model inputs (cost, delivery rates, FY27 buy)
  reports/*.json        one file per source document, holding its claims and verbatim quotes
  perspective.json      war costs vs. program costs for the /perspective/ page, each figure sourced and quote-checked
  live/                 the unverified live intercept log (events.json), its sources and run state
src/lib/
  schema.ts             zod schema for both files (the validator and the pipeline share it)
  model.ts              headline selection + the day-by-day rebuild projection
  spread.ts             every source's stock-left figure on one axis, for the "Where the estimates land" chart
  live.ts               live-log schema, merging, counts and reliability labels
  exports.ts            CSV/JSON downloads and the RSS feed
  blocks.ts             block-grid math (1 block = 10 missiles, or $50M)
  og.ts                 share-preview images (1200×630 PNGs rendered at build time)
src/pages/              Astro static site: home, /missiles/<id>/, /live/, /perspective/, /methodology/, /og/*.png,
                        /data/*.csv|json, /feed.xml, /sitemap.xml, /robots.txt
scripts/
  validate-data.ts      schema + cross-reference checks; --quotes fetches sources and checks quotes
  pipeline/watch.ts     daily: feeds → Claude drafts claims → quote check → pull request
  pipeline/inputs.ts    applies proposed model-input changes to munitions.json
  pipeline/add.ts       add one source by hand (paywalled stories, things the watcher missed)
  live/run.ts           every 6 hours: Telegram + news → Claude logs intercept counts → quote check → events.json
```

## Where the numbers come from

### Sources

| Kind       | Who                                                                          | What they give                                                                                                                                               | Tag      |
| ---------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Think tank | CSIS (Mark Cancian & Chris Park)                                             | Full inventory estimates: prewar stock, number used, number left, production rates, rebuild dates. Built from DoD budget exhibits. The backbone of the site. | Estimate |
| News       | NYT, WSJ, WaPo, CNN, CBS, Reuters, Bloomberg, Stars and Stripes, trade press | Fresher figures from officials and internal documents, often without a stated baseline ("nearly 80% used")                                                   | Reported |
| Government | DoD Inspector General, CENTCOM, CRS, CBO, officials on the record            | Costs, intercept totals, official statements. Rarely per-missile counts, since those are classified                                                          | Official |

As of October 14, 2026: 9 source documents and 45 claims (30 estimate, 11 reported, 4 official). Five of the documents are from CSIS.

### Which number becomes the headline

Every number on the home page and the missile pages is computed at build time from `data/reports/`. Nothing on the page is typed in. For each missile:

1. **Collect every stock count we can state without mixing sources:** a direct "N left" claim, or prewar minus used when _the same document_ gives both.
2. **The newest one wins,** by the date the number describes (not the publication date). A newer reported figure beats an older estimate, and an official figure gets no special priority: newest concrete number first.
3. **Ties on date** go to the more specific figure: a range or exact number beats "about", which beats "at most" or "at least".
4. **The % left** uses the same document's prewar figure, or the most recent earlier one if it doesn't give one.
5. **Anything newer that isn't a count** (a percentage of an undisclosed total, "virtually all used") shows next to the headline as _Newer reporting_ instead of being converted.

**Example:** say the NYT reports "the Army has about 600 Patriot interceptors left, according to an internal assessment" in a story dated October 20.

- **Becomes the headline:** after you merge the pull request, Patriot's big number becomes ~600 (reported). The bar, % left, days of fire and rebuild chart all follow from it.
- **Doesn't:** if the story only said "about 75% of Patriots have been used", that's a percentage of an unstated total, so it would show as _Newer reporting_ and the CSIS count would stay as the headline.

### What the model uses

The rebuild model's inputs live in `data/munitions.json`: recent deliveries per year, announced production capacity, the FY2027 budget order and when it starts arriving. Each input points at its source and quote. The daily watch can propose changes to these too, but only when an article states the figure outright (a contract's dollar value alone doesn't count). They show up in the same pull request, marked 🔧.

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
2. Keeps items that mention a tracked missile _and_ stockpile language.
3. Screens each article with Claude Haiku 5.5 (`claude-haiku-5-5`, about $0.001 each): does it state a figure about these stockpiles? Only the ones it flags go on.
4. Sends those to Claude Opus 5.5 (`claude-opus-5-5`, structured output) to draft claims with verbatim quotes, plus any model-input changes the article states outright. Roughly 5–10¢ per article, and only a few articles a week get this far. A plain fraction of stock used ("two-thirds") is entered as a share used (about 67%), with the original words kept in the note. Set the repository variables `SCREEN_MODEL` or `EXTRACT_MODEL` to use other models.
5. Throws out anything whose quote isn't on the page word for word, or that fails the schema.
6. Opens a pull request with the new report files, any `munitions.json` changes, and a summary. On quiet days the summary of what was checked is on the run's page in the Actions tab.

A person merges the pull request. Nothing reaches the site without that review.

**Setup** (repo Settings → Secrets and variables → Actions):

| Name                | Kind     | Needed?                                                                                                                                                                                                                        |
| ------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ANTHROPIC_API_KEY` | secret   | Required for drafting                                                                                                                                                                                                          |
| `NYT_API_KEY`       | secret   | Optional. Free key from developer.nytimes.com. NYT pages are paywalled, so these drafts use the abstract and are flagged for a manual quote check                                                                              |
| `USE_BING_NEWS`     | variable | On unless set to `0`. Bing News RSS is the main news source while GDELT rate-limits GitHub's runners. Bing's terms limit the feed to personal, non-commercial use: confirm the site's use fits those terms, or set this to `0` |

Run it locally without spending API credits: `npm run watch-sources -- --dry-run`.

**CSIS blocks GitHub's runners.** Since mid-November csis.org answers GitHub-hosted runners with HTTP 403, so the watch can't read new CSIS reports and the pull-request quote check fails on CSIS sources. Two ways round it, neither of which tries to get past CSIS's block:

- Add CSIS reports by hand with `--text-file` (below): save the page text from your browser, and the report is marked for a manual quote check.
- Or run the watch on a [self-hosted runner](https://docs.github.com/en/actions/hosting-your-own-runners) on your own machine and set the repository variable `WATCH_RUNNER` to its label (for example `self-hosted`). Unset, it uses `ubuntu-latest`.

### Automatic: the live intercept log

`.github/workflows/live-feed.yml` runs every 6 hours and fills the `/live/` page with drones and missiles reported shot down:

1. Reads the public web previews of the Telegram channels in `data/live/sources.json` (`t.me/s/<channel>`, no account or API key), plus the Bing News queries listed there.
2. Keeps posts that look like intercept reports, and sends them in batches to Claude Haiku, which logs counts per day, theater, defender and threat type.
3. Throws out any event whose quote isn't in the post word for word, with no count, more intercepted than launched, or a date that doesn't fit the post.
4. Merges reports of the same event from different channels, commits `data/live/events.json` to `main` and redeploys.

**Unlike the daily watch, this publishes without review, by design.** It's meant to be current, so the page labels every figure as unverified, shows each event's sources and quotes, rates it Official channel / Multiple sources / Single source, and none of it feeds the stockpile estimates. The log keeps everything it has logged, so it builds a history; the [full log](https://missiletracker.info/live/log/) lists it by month.

- Add or remove channels in `data/live/sources.json` (`official: true` only for a government's own channel).
- Turn it off by setting the repository variable `LIVE_FEED` to `0`.
- Fill in history: run the Live feed workflow by hand with **backfill days** set (say `30`). It re-reads that many days of every Telegram channel; events already logged are merged, not duplicated. News feeds only reach back a day or two.
- Cost: a few cents a day at Haiku prices (a handful of batched calls per run).
- Try it locally without API calls or writes: `npm run live-feed -- --dry-run`.

### By hand

```sh
npm run add-source -- https://www.example.com/story --outlet "Example" --published 2026-10-12
# paywalled? paste the text into a file:
npm run add-source -- https://www.nytimes.com/... --outlet "The New York Times" --title "..." --published 2026-10-12 --text-file story.txt
```

Or write a JSON file in `data/reports/` yourself, following the existing ones. `npm run validate -- --quotes` tells you if a quote doesn't match.

### Photos

Each missile has one public-domain photo from [DVIDS](https://www.dvidshub.net/). To swap one, pass the DVIDS image page:

```sh
npm run add-photo -- patriot https://www.dvidshub.net/image/9979640/... "Short alt text for screen readers"
```

It saves the 2000px preview (no DVIDS login needed) to `src/assets/photos/`, records the caption, credit and date in `data/photos.json`, and refuses images not marked public domain. If the crop cuts off the missile, set `focus` in `data/photos.json` (0 = top, 100 = bottom). The site resizes the photos at build time.

### Downloads and feeds

Every deploy publishes `/data/claims.csv` and `/data/claims.json` (every claim with its quote), `/data/headlines.json` (each missile's headline figure and the reports behind it), `/data/live-events.json` (the unverified log), and `/feed.xml` (RSS of new sources). They're linked from the methodology page and the footer.

## Deploying

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main`, and once a day so the projections' "today" line stays current. Pages is set to Source: GitHub Actions.

The site is served at **https://missiletracker.info**. The custom domain is set under Settings → Pages, with DNS pointing at GitHub Pages as described in [GitHub's custom domain docs](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site). With Actions deploys no `CNAME` file is needed in the repo.

## Visit counts

Off by default. The site can count visits with [GoatCounter](https://www.goatcounter.com/), which sets no cookies and stores no personal data, so no consent banner is needed.

1. Sign up at goatcounter.com and pick a site code, for example `missiletracker` (the dashboard is then at `missiletracker.goatcounter.com`).
2. In the repo, add the Actions variable `GOATCOUNTER_CODE` with that code.
3. Re-run the Deploy workflow. Every page then loads GoatCounter's script, and the footer says visits are counted.

## Corrections

Open an issue with the source link. Every number traces back to a file in `data/reports/`, so fixes are one-file pull requests.
