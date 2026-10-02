# AI Chavruta: biographical data sources and all-Shas / Daf Yomi infrastructure

Research date: 2026-09-28.

Labels used below:
- **VERIFIED(sef)**: seen in a live Sefaria API response, fetched with the `mcp__sef__execute-request` tool.
- **VERIFIED(gcs)**: seen in a live Google Cloud Storage JSON listing, fetched with WebFetch.
- **VERIFIED(search)**: seen in WebSearch result text. This is weaker, because it is a search-engine summary and not the primary page.
- **UNVERIFIED**: from my own knowledge, or a claim I could not reach from this sandbox.

Access notes for this session: WebFetch is blocked (EGRESS_BLOCKED) for sefaria.org, developers.sefaria.org, en.wikipedia.org, wikidata.org, query.wikidata.org and hebcal.com. github.com and storage.googleapis.com are reachable. The GitHub MCP is limited to davidraitan/sss.

---

## A. Biographical sources

### A1. Sefaria topics: `/api/v2/topics/<slug>?with_links=1` (already used)

**Samples fetched, all VERIFIED(sef):**

| Asked for | Correct slug | subclass | birth / death | places | era / generation | teachers / students | Notes |
|---|---|---|---|---|---|---|---|
| R. Eliezer b. Hyrcanus | `rabbi-eliezer-b-hyrcanus` | person | **none** | none | generation **T3** (no era) | learned-from: rabban-yochanan-b-zakkai; taught: rabbi-akiva, rabbi-ilai-(i), aquilas, rabbi-natan-habavli | `child-of` → `rabbi-eliezer-b-horkenos`, which looks like a duplicate/self topic (a data error). jeLink present. numSources 11042 |
| Rabban Gamliel (Yavneh) | `rabban-gamliel` (title "Rabban Gamliel of Yavneh (II)") | person | **none** | none | **T3** | learned-from: rabban-gamliel-hazaken-(i), rabban-yochanan-b-zakkai; taught: rabbi-hanina-b-gamliel, rabbi-elazar-hisma, rabbi-ilai-(i), rabbi-yehudah-b-ilai | **Wiki links are wrong:** enWikiLink = `Gamaliel_III` and heWikiLink = `רבן_גמליאל_ברבי`, which are the pages for his grandson. The III topic has the mirror error (enWiki `Gamaliel_II`, heWiki `רבן_גמליאל_דיבנה`), so II and III are swapped. |
| Rashba | **`rashba1`** (the slug `rashba` is an empty stub with no properties) | author | 1235 / 1310, not approximate | born Barcelona, Spain (no deathPlace) | era **RI** | learned-from ramban; taught ritva, bachya-ben-asher, shem-tov-ben-avraham-ibn-gaon, yaakov-ben-chananel-sikili; corresponded-with rosh, abba-mari | The English description says "13th century". enBio and heBio say "14th century", so the prose contradicts itself. |
| Meiri | **`menachem-meiri`** (the slug `meiri` is an empty stub) | author | 1249 / 1315 | Perpignan / Perpignan | RI | **none** | |
| Maharsha | `maharsha` | author | 1555 / 1631 | Krakow / Ostroh | AH | **none** (only cousin-of maharal) | The `sex` property holds the value `"maharal"`, which is a data-entry bug |
| Penei Yehoshua | **`jacob-joshua-falk`** (found through the author field of `/api/v2/index/Penei Yehoshua on Berakhot`) | author | 1680 / 1756 | Krakow, Poland / Offenbach | AH | taught: moses-ben-isaac-judah-lima (no teachers) | The description says "early 19th-century", which contradicts 1680–1756. The Eybeschutz hyperlink points to `yaakov-emden`. |
| Ben Ish Chai | **`yosef-hayyim`** (the name API finds no match for "Ben Ish Chai") | author | 1835 / 1911 | Baghdad / Baghdad | AH | none | |
| R. Akiva Eiger | `akiva-eiger` | author | 1761 / 1837 | Eisenstadt, Austria / Posen | AH | none | Hebrew description is empty |
| (extra) Hai Gaon | `hai-gaon` | author | 939 / 1038, marked not approximate | none | era **GN** | child-of sherira-gaon; corresponded-with nissim-gaon **and itself** | |
| (extra) Rava | `rava` | person | none | none | **A4** | not fetched | |

**Conclusions (my inferences from the samples above):**
- There are two populations of people in Sefaria's data:
  - **"person"** topics (Chazal, from the old person collection plus Aspaklaria). These have `generation` (T1…, A1…, TA as seen for Rabban Gamliel III), teacher/student links and jeLink, but **no years or places**.
  - **"author"** topics (Geonim, Rishonim, Acharonim who have books on Sefaria). These have `birthYear`, `deathYear`, `birthPlace`, `deathPlace`, `era` (GN / RI / AH), `*IsApprox` flags, and en/he bio. Teacher/student links are **sparse**: Rashba had them, Meiri, Maharsha, R. Akiva Eiger and Ben Ish Chai had none.
- For Chazal, "who came first" can only be answered from the `generation` codes, not from years.
- For Rishonim and Acharonim, "who came first" works from birth and death years. "Whose student" often returns nothing, and the app must then say it has no record.
- **Slug traps:** `rashba` and `meiri` are empty stubs, while the real records are `rashba1` and `menachem-meiri`. VERIFIED(sef) that `/api/name/Rashba` returns `key: "rashba1"` with `type: "AuthorTopic"`, and `/api/name/Menachem Meiri` returns `menachem-meiri`. **Always resolve through `/api/name/<q>` and prefer `type` of `AuthorTopic` or `PersonTopic`. Reject topics that have no `properties` and `numSources` of 0–2.** Name search does not resolve book names to authors ("Penei Yehoshua" and "Ben Ish Chai"). For those, use `/api/v2/index/<book title>` and read its `authors[].slug` (VERIFIED(sef) for Penei Yehoshua).
- **Reliability:** the structured numeric fields are usable. Free-text descriptions contain errors (century mistakes, bad hyperlinks). Wikipedia links can be wrong, as with the Gamliel II/III swap. The app should quote numbers, not prose, and should cross-check any Wikipedia page it follows against the Sefaria topic (see A3).
- **Access and license:** official JSON API with no key. Sefaria's own topic metadata is generally CC-BY-SA per Sefaria; exact terms per data source are UNVERIFIED. The export bucket has `misc/topic_graph.csv` (15,603,804 bytes, updated 2026-09-01, VERIFIED(gcs)). Its contents could not be read because the file is over 10 MB. It is probably the topic-to-topic link graph (learned-from / taught), but that is UNVERIFIED. Downloading it once would give the whole teacher/student graph offline.

### A2. Namesake disambiguation per page (Sefaria)

- **Ambiguous topics:** `/api/v2/topics/rebban-gamliel-(ambiguous)` returns `isAmbiguous: true` and a `possibilities[]` array with the full records of `rabban-gamliel` (II, T3), `rabban-gamliel-b-rabbi-(iii)` (TA) and `rabban-gamliel-hazaken-(i)` (T1). VERIFIED(sef). Each real person also lists the ambiguous pseudo-topics it belongs to under `links.possibility-for` (for example R. Eliezer → `eliezer-(ambiguous)`, `rabbi-eleazar-(ambiguous)` and others).
- **`/api/ref-topic-links/<tref>`:**
  - Its OpenAPI spec lists only the path parameter `tref`.
  - A bare call returns `{"error": "Invalid language. Must be 'english' or 'hebrew'."}`, and `?lang=english` returns the same error.
  - **`?interface_lang=english` works** (VERIFIED(sef)). The parameter is undocumented but required. `&annotate=1` adds titles and descriptions.
  - On `Berakhot 2a:1` it returned only `linkType: "about"` topics (laws-of-the-recitation-of-shema, shema, prayer, priesthood, terumah, blessings), and **no people**. So this endpoint does **not** expose named-entity "mention" links.
- **What does work:** `/api/v2/topics/<person-slug>?with_refs=1`. It returns `refs.mention.refs[]`, a per-segment record of where that exact person is named in the text, for example `{"ref":"Ketubot 10a:12", "charLevelData":{"startChar":..,"endChar":..,"versionTitle":"William Davidson Edition - English","text":"Rabban Gamliel bar Rabbi"}}`. `similarRefs` holds the same mention in the Aramaic, vocalized and Wikisource versions. For `rabban-gamliel-b-rabbi-(iii)` it listed Niddah 63b:9, Ketubot 10a:12, Ketubot 10b:2, Niddah 63b:7, Bava Batra 139b:8, Menachot 84b:14, Chullin 106a:6, Chullin 98a:13, several Yerushalmi refs and Pirkei Avot 2:2. VERIFIED(sef). **This is Sefaria's named-entity resolution: it has already decided which Rabban Gamliel is meant in each Bavli segment.**
- **Recommended algorithm:**
  1. When the user asks "which Rabban Gamliel is this?" on ref R, look up the ambiguous topic (search `/api/name/` for the bare name, or use the `possibility-for` link).
  2. For each possibility, fetch `with_refs=1`, or better, a cached inverted index. Check whether R's segment appears in that person's `mention` refs.
  3. Answer with the one that matches, citing Sefaria. If none or several match, say it is unresolved.
  - Payloads can be large for common names (R. Eliezer has 11,042 sources, Rava 20,955). **Build the index offline once:** iterate over every person under `talmudic-figures`, collect the mention refs, and invert them into `segment → [slugs]`. Refresh monthly.
  - `/api/texts/<ref>?wrapNamedEntities=1` (the v1 endpoint that the Sefaria reader uses to underline names) could give this per page directly. That is UNVERIFIED: the MCP refused v1 `/api/texts` and WebFetch to sefaria.org is blocked. Test it from the app. If it works, it is the cheapest per-page route.
  - The v3 `/api/v3/texts/Berakhot 2a:1` English text has no entity markup (VERIFIED(sef)).

### A3. Wikipedia (en and he) and Wikidata

All UNVERIFIED in this session (egress blocked) unless marked otherwise.
- **en/he Wikipedia REST:** `https://{en|he}.wikipedia.org/api/rest_v1/page/summary/<title>` returns `extract`, `description` and `wikibase_item` (the Q-id). MediaWiki `action=query&prop=pageprops&ppprop=wikibase_item` gives the Q-id; `prop=extracts` gives plain text. License CC BY-SA 4.0 with attribution. Hebrew Wikipedia is much richer for Acharonim and minor Amoraim.
- **Wikidata:** `wbgetentities&ids=Q..&props=claims|labels|sitelinks`, or SPARQL at `query.wikidata.org/sparql`. Useful properties: P569 date of birth, P570 date of death, P19 place of birth, P20 place of death, P1066 student of, P802 student, P22 father, P40 child, P1343 "described by source" (which often points to the Jewish Encyclopedia), P3710 Jewish Encyclopedia ID (UNVERIFIED number), P2888 exact match. Dates carry precision (year, decade, century) and qualifiers such as P1480 "circa". This is better than Sefaria's plain integers. License **CC0**, so no attribution burden.
  - VERIFIED(search): Rashba is Q982170 and Wikidata gives birth ~1235 and death 1310.
  - Wikidata/Wikipedia **Gamaliel II** = the Yavneh nasi ("first to lead the Sanhedrin as nasi after the fall of the Second Temple", VERIFIED(search)), and **Gamaliel III** = son of Rabbi. This confirms that Sefaria's links for II/III are swapped.
  - Generation numbering differs by source: Wikipedia calls Gamaliel II "second generation of tannaim" (VERIFIED(search)), while Sefaria says T3. Always name the source of a generation label.
- **Wikidata ↔ Sefaria link:** WebSearch showed the Wikidata item for Sefaria (Q33424604) naming a "main property: Sefaria ID", but I could not see its P-number or whether it is used for topic slugs rather than text IDs (UNVERIFIED). Separately, Sefaria's own records carry `heWikiLink` with `"data_source": "wikidata"` (VERIFIED(sef), on the Gamliel and Rava topics), so Sefaria imported links from Wikidata.
  - **Practical bridge:** take the Sefaria topic's `enWikiLink` or `heWikiLink`, call Wikipedia's `pageprops` to get the Q-id, then call Wikidata. **Guard against the swap:** check that the Wikidata label or aliases and the P569/P570 range are consistent with Sefaria's `generation` or `era` before trusting the result.
- **Coverage:** very good for major Tannaim and Amoraim, Geonim, Rishonim and Acharonim. Patchy for minor Amoraim. P1066/P802 are filled for famous people only.

### A4. Other encyclopedias

| Source | Coverage | Access | License | Verdict |
|---|---|---|---|---|
| **Jewish Encyclopedia 1906** (jewishencyclopedia.com) | Strong on Tannaim, Amoraim, Geonim and Rishonim; Acharonim only up to about 1900 | Stable HTML at `/articles/<id>-<slug>`, no API. Sefaria stores `jeLink` on many topics (VERIFIED(sef): old-style `view.jsp?artid=` links for Chazal, new-style `/articles/8422-...` for Falk; for Rashba it is only a search URL). The site has a Terms of Use page (VERIFIED(search): exists); its scraping terms are unknown. | Text public domain (1901–06) | **Usable as a cited quote source.** Fetch HTML and extract paragraphs. Scholarship is dated. |
| Encyclopaedia Judaica (encyclopedia.com) | Broad | HTML, heavy ads, no API | © Gale / Keter, **not free** | Not usable for bulk; link out only |
| Chabad.org | Short bios of major figures (VERIFIED(search): a Rashba page exists at aid/111870 with dates 1235–1310) | HTML only | © Chabad.org, all rights reserved | Link out only |
| Da'at (daat.ac.il) | Hebrew encyclopedia entries plus the "דור דור ודורשיו" ordering of Talmudic sages (VERIFIED(search): page exists at daat.ac.il/daat/toshba/brahot/dor-2.htm) | HTML, old encodings | © Da'at / Herzog College | Link out or quote briefly; not a data source |
| Otzar HaChochma, Bar-Ilan Responsa Project | Deep, incl. "חכמי התלמוד" | Paid, no public API | Proprietary | Not usable |
| Hyman, *Toldot Tannaim VeAmoraim* (1910) | ~all Tannaim and Amoraim, with teachers/students and sources | Scanned PDF on Hebrew Wikipedia/Commons (VERIFIED(search): "Aaron Hyman. Toldoth Tannaim veAmoraim. II. 1910.pdf"); also on HebrewBooks (UNVERIFIED) | Public domain | Excellent content but OCR-only, no structure. Treat as a later project. |
| daf-yomi.com "תולדות האמוראים חכמי התלמוד" PDF (VERIFIED(search): exists) | Amoraim | PDF | © | Link only |

I found **no open, structured Chazal generations dataset** on GitHub (VERIFIED(search): a negative result). Sefaria's person topics, which come from Aspaklaria plus Sefaria's person collection, are effectively the best open structured Chazal database.

---

## B. Infrastructure for all of Shas

### B1. Today's Daf Yomi

- **Sefaria `/api/calendars`** (VERIFIED(sef), including the OpenAPI spec). Query parameters: `diaspora` (0 or 1), `custom`, `year` + `month` + `day` (all three or none), `timezone` (IANA). Response: `{date, timezone, calendar_items:[{title:{en,he}, displayValue:{en,he}, url, ref, heRef?, order, category, extraDetails?, description?}]}`.
  - Select the item where `title.en == "Daf Yomi"`.
  - Live result for 2026-09-28: `{"title":{"en":"Daf Yomi","he":"דף יומי"},"displayValue":{"en":"Bekhorot 10","he":"בכורות י׳"},"url":"Bekhorot.10","ref":"Bekhorot 10","order":3,"category":"Talmud"}`.
  - The daf item had **no `heRef`**. The ref is the **whole daf**, so the app must expand it to `10a` and `10b`.
  - With no parameters the server defaults to UTC (the response said `"timezone":"UTC"`). **Always pass `timezone`**, or the date explicitly.
  - Other items present: Yerushalmi Yomi, Daf a Week, Daily Mishnah, Daily Rambam and others.
- **Offline check (my arithmetic):** cycle 14 began 2020-01-05. 2020-01-05 → 2026-09-28 is 2,458 days, so today is daf number 2,459 of 2,711. The cumulative total through Chullin is 2,450, which gives Bekhorot 10. This matches Sefaria. The cycle is deterministic, so the app can compute it locally with no network. The standard daf-count table is needed; Shekalim counts 21 dafim (2–22).
- **Hebcal backup:** `https://www.hebcal.com/hebcal?v=1&cfg=json&F=on&start=YYYY-MM-DD&end=YYYY-MM-DD`. Items have `category:"dafyomi"`, `title` (e.g. "Yevamot 91"), `hebrew`, `hdate` and `link` to Sefaria (VERIFIED(search)). The endpoint was not reachable from here. There is also the `@hebcal/learning` npm package (VERIFIED(search): repo hebcal/hebcal-learning, "Daf Yomi, Mishna Yomi, Nach Yomi") for offline computation. Hebcal license: API free; library code GPL/BSD (UNVERIFIED).

### B2. Sefaria rate limits, terms, and bulk export

- **Rate limits:** no published numeric limit found. The developer docs urge "self-imposed rate limiting" and point bulk users to Sefaria-Export instead of per-ref API calls (VERIFIED(search), developers.sefaria.org). Suggestion: at most about 2–5 requests per second with a User-Agent and email, and a cache.
- **Sefaria-Export (recommended for all of Shas):** public GCS bucket `gs://sefaria-export/`, HTTP at `https://storage.googleapis.com/sefaria-export/<format>/<categories>/<title>/<language>/<versionTitle>.json`, no auth. About 26 GB and about 85K files in total. Rebuilt monthly: last export 2026-09-01, and `books.json` in the GitHub repo is regenerated on the 2nd of each month. Source: VERIFIED(search) plus the github.com README via WebFetch.
  - Top-level prefixes: `cltk-flat/ cltk-full/ json/ links/ misc/ schemas/ txt/`, plus `table_of_contents.json` (10.8 MB). VERIFIED(gcs).
  - Berakhot sizes (VERIFIED(gcs)): English `merged.json` 1,523,782 B; `William Davidson Edition - English.json` 1,524,331 B; Hebrew `merged.json` 1,166,009 B; `William Davidson Edition - Aramaic.json` 679,202 B.
  - **Rough estimate for all Bavli** (~2,711 dafim ÷ 63 ≈ 43×): about 65 MB English plus 50 MB vocalized Aramaic, so **about 120 MB for gemara text**. This is my extrapolation, UNVERIFIED.
  - Commentaries sit under `json/Talmud/Bavli/Rishonim on Talmud/<Rashi|...>/<Seder>/...` (VERIFIED(gcs): Rashi has six Seder folders). Acharonim are under `Acharonim on Talmud/`.
  - **Links:** `links/links0.csv` … `links16.csv`, 17 files of 34.7–47.0 MB each (≈ 677 MB total), plus `links_by_book.csv` (14.0 MB) and `links_by_book_without_commentary.csv` (13.7 MB). VERIFIED(gcs). Filter these for Bavli refs once and store a per-amud index.
  - **Topics / people:** only `misc/topic_graph.csv` (15.6 MB, VERIFIED(gcs)). The per-ref *mention* links (the named-entity data in A2) are **not** in the export (UNVERIFIED but likely). Build that index from the API once (A2) or from the Mongo dump.
- **MongoDB dump:** `https://storage.googleapis.com/sefaria-mongo-backup/dump_small.tar.gz` (VERIFIED(search), URL only). There is a "recommended" small dump and a complete dump with history; MongoDB ≥ 4.4 required (VERIFIED(search), developers.sefaria.org). Size unknown: the bucket listing returned 401. Several GB is UNVERIFIED. The dump includes the `topics` and `topic_links` collections (UNVERIFIED, based on the Sefaria-Project schema), so it is the **one source with everything**: texts, links, people and mentions. It is heavy, but good for a one-time offline build of the people index.
- **Licenses matter for an app:** the William Davidson (Koren–Steinsaltz) English and Aramaic are **CC-BY-NC** (VERIFIED(sef), v3 texts `license` field). Wikisource Talmud Bavli (Hebrew) is **CC-BY-SA** and A. Cohen's 1921 Berakhot is **Public Domain** (both VERIFIED(sef)). A commercial app must not ship Davidson text in bulk; it should fetch live with attribution or use the CC-BY-SA/PD versions.
- **Per-amud API alternative:** about 5,422 amudim, each needing texts plus links (or `/api/related/<ref>`, which returns links, sheets and topics in one call; VERIFIED(sef) spec). `/api/bulktext/<ref1|ref2|...>` fetches many refs in one call (VERIFIED(sef), endpoint exists). This is fine for lazy per-session prefetch of today's daf and the next few, but use the Export for a full build.

### B3. Other free Talmud sources (UNVERIFIED unless noted)

- **Hebcal:** calendar and learning schedules (above).
- **Wikisource (he.wikisource.org):** full Vilna Bavli text with Rashi and Tosafot through the MediaWiki API, CC-BY-SA. Already mirrored in Sefaria as "Wikisource Talmud Bavli" (VERIFIED(sef)).
- **Dicta** (dicta.org.il): Nakdan, Talmud search and citation tools with free web APIs; terms vary.
- **Al HaTorah, Mercava, daf-yomi.com, Steinsaltz Center:** no open APIs, so link out only.

---

## Recommendations (summary)

1. **Keep Sefaria as the primary people source, but harden it:**
   - Resolve names with `/api/name` and accept only `AuthorTopic` or `PersonTopic`.
   - Reject stub topics (no `properties`).
   - Map book to author through `/api/v2/index/<book>` `authors[].slug`.
   - Answer "when" from `birthYear`/`deathYear` plus `*IsApprox`, or from `generation`/`era`.
   - Answer "whose student" only from `learned-from`/`taught`, and say "no record" when those are empty.
2. **Add Wikidata second (CC0),** reached through the Sefaria wiki link → Wikipedia `pageprops` → Q-id → P569/P570/P19/P20/P1066/P802. Use it to fill missing years, places and teachers, but only after a consistency check against Sefaria's generation or era, because of the Gamliel II/III swap.
3. **Add Hebrew and English Wikipedia summaries third,** quoted with attribution (CC BY-SA). The Hebrew article is better for Acharonim.
4. **Add the Jewish Encyclopedia 1906 fourth,** through Sefaria's `jeLink` (public domain). Label it as 1906 scholarship. Skip EJ, Chabad, Da'at and Otzar HaChochma as data sources; link out only.
5. **Namesakes per page:** use Sefaria's named-entity mention data. Build an offline `segment → person-slug` index from `/api/v2/topics/<slug>?with_refs=1` (`refs.mention`) for all talmudic-figures, or from the Mongo dump. At runtime, intersect the current segment with the candidates listed in the `(ambiguous)` topic's `possibilities`. `/api/ref-topic-links` needs `interface_lang=english` and does not return people. Test `wrapNamedEntities=1` on the v1 texts API as a possible cheaper route.
6. **Daf Yomi:** compute locally (deterministic cycle from 2020-01-05); confirm with Sefaria `/api/calendars?timezone=…` (item `title.en=="Daf Yomi"`, `ref` = whole daf); use Hebcal `F=on` as a fallback.
7. **All of Shas:** build from Sefaria-Export: roughly 120 MB of gemara JSON plus about 677 MB of link CSVs to filter down, refreshed monthly after the 1st. Watch the CC-BY-NC terms on the Davidson/Steinsaltz text.
