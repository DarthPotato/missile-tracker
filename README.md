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
  perspective.json      war costs vs. program costs for the /perspective/ page, each figure sourced and quote-checked
src/lib/
  schema.ts             zod schema for both files (the validator and the pipeline share it)
  model.ts              headline selection + the day-by-day rebuild projection
  blocks.ts             block-grid math (1 block = 10 missiles, or $50M)
  og.ts                 share-preview images (1200×630 PNGs rendered at build time)
src/pages/              Astro static site: home, /missiles/<id>/, /perspective/, /methodology/, /og/*.png
scripts/
  validate-data.ts      schema + cross-reference checks; --quotes fetches sources and checks quotes
  pipeline/watch.ts     daily: feeds → Claude drafts claims → quote check → pull request
  pipeline/inputs.ts    applies proposed model-input changes to munitions.json
  pipeline/add.ts       add one source by hand (paywalled stories, things the watcher missed)
```

## Where the numbers come from

### Sources

| Kind | Who | What they give | Tag |
| --- | --- | --- | --- |
| Think tank | CSIS (Mark Cancian & Chris Park) | Full inventory estimates: prewar stock, number used, number left, production rates, rebuild dates. Built from DoD budget exhibits. The backbone of the site. | Estimate |
| News | NYT, WSJ, WaPo, CNN, CBS, Reuters, Bloomberg, Stars and Stripes, trade press | Fresher figures from officials and internal documents, often without a stated baseline ("nearly 80% used") | Reported |
| Government | DoD Inspector General, CENTCOM, CRS, CBO, officials on the record | Costs, intercept totals, official statements. Rarely per-missile counts, since those are classified | Official |

As of October 14, 2026: 9 source documents and 45 claims (30 estimate, 11 reported, 4 official). Five of the documents are from CSIS.

### Which number becomes the headline

Every number on the home page and the missile pages is computed at build time from `data/reports/`. Nothing on the page is typed in. For each missile:

1. **Collect every stock count we can state without mixing sources:** a direct "N left" claim, or prewar minus used when *the same document* gives both.
2. **The newest one wins,** by the date the number describes (not the publication date). A newer reported figure beats an older estimate, and an official figure gets no special priority: newest concrete number first.
3. **Ties on date** go to the more specific figure: a range or exact number beats "about", which beats "at most" or "at least".
4. **The % left** uses the same document's prewar figure, or the most recent earlier one if it doesn't give one.
5. **Anything newer that isn't a count** (a percentage of an undisclosed total, "virtually all used") shows next to the headline as *Newer reporting* instead of being converted.

**Example:** say the NYT reports "the Army has about 600 Patriot interceptors left, according to an internal assessment" in a story dated October 20.
- **Becomes the headline:** after you merge the pull request, Patriot's big number becomes ~600 (reported). The bar, % left, days of fire and rebuild chart all follow from it.
- **Doesn't:** if the story only said "about 75% of Patriots have been used", that's a percentage of an unstated total, so it would show as *Newer reporting* and the CSIS count would stay as the headline.

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
2. Keeps items that mention a tracked missile *and* stockpile language.
3. Sends each article to Claude Haiku 5.5 (`claude-haiku-5-5`, structured output) to draft claims with verbatim quotes, plus any model-input changes the article states outright. Roughly $0.001–0.002 per article.
4. Throws out anything whose quote isn't on the page word for word, or that fails the schema.
5. Opens a pull request with the new report files, any `munitions.json` changes, and a summary. On quiet days the summary of what was checked is on the run's page in the Actions tab.

A person merges the pull request. Nothing reaches the site without that review.

**Setup** (repo Settings → Secrets and variables → Actions):

| Name | Kind | Needed? |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | secret | Required for drafting |
| `NYT_API_KEY` | secret | Optional. Free key from developer.nytimes.com. NYT pages are paywalled, so these drafts use the abstract and are flagged for a manual quote check |
| `USE_BING_NEWS` | variable | On unless set to `0`. Bing News RSS is the main news source while GDELT rate-limits GitHub's runners. Bing's terms limit the feed to personal, non-commercial use: confirm the site's use fits those terms, or set this to `0` |

Run it locally without spending API credits: `npm run watch-sources -- --dry-run`.

### By hand

```sh
npm run add-source -- https://www.example.com/story --outlet "Example" --published 2026-10-12
# paywalled? paste the text into a file:
npm run add-source -- https://www.nytimes.com/... --outlet "The New York Times" --title "..." --published 2026-10-12 --text-file story.txt
```

Or write a JSON file in `data/reports/` yourself, following the existing ones. `npm run validate -- --quotes` tells you if a quote doesn't match.

## Deploying

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to `main`, and once a day so the projections' "today" line stays current. Pages is set to Source: GitHub Actions.

The site is served at **https://missiletracker.info** (registrar: Porkbun). DNS: four `A` records to `185.199.108–111.153`, four `AAAA` records to `2606:50c0:8000–8003::153`, `www` as a `CNAME` to `darthpotato.github.io`, plus the `_github-pages-challenge-DarthPotato` TXT record that verifies the domain. The custom domain is set under Settings → Pages. With Actions deploys no `CNAME` file is needed in the repo.

## Corrections

Open an issue with the source link. Every number traces back to a file in `data/reports/`, so fixes are one-file pull requests.
