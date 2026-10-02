# Gemara commentaries: where the text lives and how to fetch it

Research date: 2026-09-28. Written for the AI Chavruta app (Berakhot now, all of Shas planned).

## Evidence key

| Tag | Meaning |
|---|---|
| **V-TOC** | VERIFIED: seen in Sefaria `https://www.sefaria.org/api/index` (full TOC, 6,606 indexes, pulled via `mcp__sef__execute-request`) |
| **V-IDX** | VERIFIED: seen in `https://www.sefaria.org/api/v2/index/<Title>` |
| **V-LNK** | VERIFIED: seen in `https://www.sefaria.org/api/links/<Ref>` (checked for Berakhot 2a and 5a, Ein Yaakov, Berakhot 1, and Ein Ayah 1 and 2) |
| **V-VER** | VERIFIED: seen in `https://www.sefaria.org/api/texts/versions/<Title>` (the license field) |
| **V-WS** | VERIFIED only that a web-search result with this title and URL exists. The page itself was **not** fetched, because he.wikisource.org, alhatorah.org, hebrewbooks.org, dicta.org.il and daat.ac.il are all blocked by this sandbox's egress proxy. |
| **UNVERIFIED** | Background knowledge or a search-engine summary that was not confirmed in a tool result |

"Coverage" lists the Bavli tractates for which a Sefaria index exists (V-TOC). The Bavli has 37 tractates with Gemara. Having an index does not mean every daf has text.

---

## 0. How the app should use Sefaria (all VERIFIED)

* **Finding the commentaries on a daf:** call `GET /api/links/Berakhot.2a`. Each link record has `index_title` (for example `"Chidushei Halachot on Berakhot"`), `collectiveTitle.en` (for example `"Chidushei Halachot"`), `category` and `type`. Commentaries have `type:"commentary"`. **V-LNK**
* **Mesoret HaShas** is a link type: `type:"mesorat hashas"`, pointing to parallel Talmud, Mishnah and Midrash passages. It is not a text you can fetch. On Berakhot 2a there are 4 such links. **V-LNK**
* **Ein Mishpat / Ner Mitzvah** is also a link type: `type:"ein mishpat / ner mitsvah"`, pointing into Mishneh Torah, SMaG, Tur and Shulchan Arukh. On Berakhot 2a there are 23 such links. **V-LNK**
* **Torah Or** has no separate index and no link type of its own. The verse citations appear as Tanakh links with `type:""`. **V-LNK**
* **Text is also embedded in the links.** A links call without `with_text=0` returns `he`, `text`, `license` and `versionTitle` for each linked segment. **V-LNK** (seen on 5a)
* **Versions and licenses:** `GET /api/texts/versions/<Title>`. Examples:
  * Gemara Berakhot, "William Davidson Edition" (Aramaic and English): CC-BY-NC.
  * "Wikisource Talmud Bavli": CC-BY-SA.
  * Rashi on Berakhot, "Vilna Edition": Public Domain.
  * Steinsaltz on Berakhot (Hebrew): CC-BY-NC.

  **V-VER**

---

## 1. Commentaries printed on the Vilna page

| Work | Sefaria index title (Berakhot) / `collectiveTitle` | Shas coverage on Sefaria | Other machine-readable text | Scan only | Copyright / notes |
|---|---|---|---|---|---|
| Rashi | `Rashi on Berakhot` / `Rashi` **V-IDX/V-LNK** | 36 of 37: every tractate except Tamid **V-TOC** | he.wikisource: daf pages such as `ברכות_ב_א`, plus index page `פירוש_רש"י_לתלמוד_בבלי_ברכות` **V-WS**. AlHaTorah Shas HaMeforash **V-WS** | HebrewBooks Shas pages **V-WS** | Hebrew "Vilna Edition" is Public Domain **V-VER** |
| Tosafot | `Tosafot on Berakhot` / `Tosafot` **V-LNK** | 36: same set as Rashi (no Tamid) **V-TOC** | he.wikisource `תוספות_על_הש"ס/ברכות/פרק_א` **V-WS** | HebrewBooks | PD (UNVERIFIED for the Sefaria version) |
| Rabbeinu Chananel | `Rabbeinu Chananel on <Tractate>` / `Rabbeinu Chananel` **V-TOC** | 18: Shabbat, Eruvin, Pesachim, RH, Yoma, Sukkah, Beitzah, Taanit, Megillah, MK, Chagigah, BK, BM, Sanhedrin, Makkot, Shevuot, AZ, Horayot. **No Berakhot.** **V-TOC** | he.wikisource `רבינו_חננאל_על_הש"ס/<tractate>/פרק_X` **V-WS** (Pesachim was seen; no Berakhot page was confirmed). AlHaTorah lists "ר' חננאל" **V-WS** | Otzar HaGeonim Berakhot (below) collects Geonic and R"Ch material (UNVERIFIED) | For Berakhot: **not fetchable**. Offer a link only. |
| Mesoret HaShas | No index. Link `type:"mesorat hashas"` **V-LNK** | Every daf that has links | he.wikisource daf pages are reported to include it (search summary, UNVERIFIED) | Vilna page | Use it as cross-reference links, not as a quotable text |
| Ein Mishpat Ner Mitzvah | No index. Link `type:"ein mishpat / ner mitsvah"` **V-LNK** | Same | he.wikisource daf pages are reported to include it (UNVERIFIED) | Vilna page | Same as Mesoret HaShas |
| Torah Or | No index. Untyped Tanakh links **V-LNK** | n/a | he.wikisource daf pages (UNVERIFIED) | Vilna page | Same as Mesoret HaShas |
| Hagahot HaBach (on the Gemara) | **None on the Gemara.** Sefaria has only `Hagahot HaBach on Rif Berakhot` (CT `Hagahot HaBach`), whose base texts are the Rif, R. Yonah, Shiltei HaGiborim and Milchemet Hashem **V-TOC** | On the Rif only: 24 tractates **V-TOC** | he.wikisource daf pages (UNVERIFIED) | HebrewBooks / Vilna | The Bach on the Gemara is **link-only** |
| Hagahot HaGra (on the Gemara) | **None.** Sefaria's Gra works are on the Yerushalmi, Shulchan Arukh, Avot and minor tractates ("Gra's Nuschah") **V-TOC** | n/a | he.wikisource daf pages (UNVERIFIED) | Vilna page | Link-only |
| Gilyon HaShas (R. Akiva Eiger) | `Gilyon HaShas on Berakhot` / `Gilyon HaShas` **V-IDX/V-LNK** | 36: every tractate except Tamid **V-TOC** | he.wikisource (UNVERIFIED) | Vilna page | PD |

## 2. Rishonim

| Work | Sefaria index title / `collectiveTitle` | Shas coverage on Sefaria | Other text sources | Scan | Notes |
|---|---|---|---|---|---|
| Rif | `Rif Berakhot` (**no "on"**) / `Rif` **V-IDX** | 25 base "Rif X" indexes **V-TOC** | he.wikisource (UNVERIFIED) | HebrewBooks | **Addressed by the Rif's own folio numbers** (Rif Berakhot 1a–45a), not by Gemara daf. Reach it through links. **V-IDX** |
| Talmidei Rabbeinu Yonah | `Rabbeinu Yonah on Berakhot` / `Rabbeinu Yonah`. The base text is `Rif Berakhot`. heDesc = "נימוקי תלמידי רבינו יונה" **V-IDX** | Berakhot only **V-TOC** | forum.otzar.org discussion only **V-WS** | HebrewBooks | Match the name "Rabbeinu Yonah", not "Talmidei". Addressed by Rif daf. |
| Rosh (Piskei HaRosh) | `Rosh on Berakhot` / `Rosh`. Structure: Chapter:Halakhah:Siman **V-IDX** | 27 tractates **V-TOC** | he.wikisource `רבינו_אשר_על_הש"ס/פסקי_הרא"ש/ברכות/פרק_א` **V-WS** | HebrewBooks | Rosh commentaries on Sefaria: Maadaney Yom Tov and Divrey Chamudot (Berakhot, Menachot, Niddah); Korban Netanel (13); Tiferet Shmuel (8); Pilpula Charifta (6) **V-TOC** |
| Tosafot HaRosh | `Tosafot HaRosh on Berakhot` / `Tosafot HaRosh` **V-TOC/V-LNK** | Berakhot, Kiddushin, Horayot, Niddah **V-TOC** | he.wikisource `תוספות_הרא"ש_על_הש"ס/ברכות/פרק_א` **V-WS** | HebrewBooks | |
| Ramban | `Chiddushei Ramban on Berakhot` / `Chiddushei Ramban` **V-TOC** | 26 tractates, plus `Hilkhot HaRamban on Nedarim` **V-TOC** | he.wikisource (UNVERIFIED) | HebrewBooks | Match "Chiddushei Ramban", not "Ramban" (which is the Torah commentary). Also `Milchemet Hashem on Berakhot` (CT `Milchemet Hashem`, Ramban on the Rif and Baal HaMaor): 23 tractates plus an introduction **V-TOC** |
| Rashba | `Rashba on Berakhot` / `Rashba` **V-TOC/V-LNK** | 18 tractates. `Rashba on Menachot` has the different CT `Rashba (Attributed)` **V-TOC** | he.wikisource `חידושי_הרשב"א_על_הש"ס/ברכות/פרק_א` **V-WS** | HebrewBooks 42067 (Berakhot) and 49391 **V-WS** | |
| Ritva | `Ritva on Berakhot` / `Ritva` **V-TOC/V-LNK** | 18 tractates **V-TOC** | he.wikisource (UNVERIFIED). AlHaTorah **V-WS** | HebrewBooks | |
| Ran | No Berakhot. `Ran on Nedarim` is on the Gemara. `Ran on <14 tractates>` sit under Rif/Commentary (on the Rif). CT `Ran` for both **V-TOC** | Nedarim, plus 14 on the Rif **V-TOC** | he.wikisource (UNVERIFIED) | HebrewBooks | Berakhot: link-only |
| Ra'ah | `Chiddushei HaRa'ah on Berakhot` / CT **`Ra'ah`**. Title variant: `Chidushei HaRa'ah on Berakhot` **V-IDX** | Berakhot. Also `Chiddushei HaRa'ah on Ketubot`, whose CT is **`Chiddushei HaRa'ah`** (a different CT) **V-TOC** | | | The Berakhot source is the 2007 Jerusalem edition, license "unknown" **V-VER**. Quote with care; flag the license. |
| Meiri (Beit HaBechirah) | `Meiri on Berakhot` / `Meiri` **V-TOC/V-LNK** | 30 tractates **V-TOC** | he.wikisource `מאירי_על_הש"ס/ברכות/פרק_ג`. **Sefaria's Hebrew is sourced from Wikisource** **V-VER/V-WS** | HebrewBooks | License "unknown" on Sefaria **V-VER** |
| Shita Mekubetzet | `Shita Mekubetzet on Berakhot` / `Shita Mekubetzet`. Filed under **Acharonim**. Structure: Daf:Line:Comment **V-IDX** | 9: Berakhot, Beitzah, Ketubot, Sotah, BK, BM, BB, plus Nedarim and Nazir spelled **`Shita Mekubbetzet`** **V-TOC** | he.wikisource (UNVERIFIED) | HebrewBooks | Sefaria's enDesc: "Shita Mekubetzet on Berakhot … is actually the commentary of the Ritva" **V-IDX** |
| Tosafot Rid | `Tosafot Rid on <T>` / `Tosafot Rid` **V-TOC** | 25 indexes, **no Berakhot**. Some titles carry recension suffixes, for example `Tosafot Rid on Megillah First Recension` **V-TOC** | | HebrewBooks | Berakhot: none |
| Piskei Riaz | **None** **V-TOC** | – | NLI holds a manuscript, "פסקי ריא"ז (ברכות)" **V-WS** | NLI manuscript | Link-only |
| Yad Ramah | `Yad Ramah on Sanhedrin` / `on Bava Batra` / CT `Yad Ramah` **V-TOC** | Sanhedrin, BB | | HebrewBooks | Not relevant to Berakhot |
| Ri Migash | `Ri Migash on Bava Batra` / `on Shevuot` / CT `Ri Migash` **V-TOC** | BB, Shevuot | | | Not relevant to Berakhot |
| Mordechai | Only `Mordechai on Bava Batra` / CT **`Mordechai on Bava Batra`** **V-TOC** | BB only | he.wikisource page "מרדכי", described as still being typed in **V-WS** | Vilna back matter / HebrewBooks | Berakhot: link-only |
| Or Zarua | `Ohr Zarua` (spelled Ohr), filed under Halakhah/Rishonim, not a daf commentary. It is linked from Berakhot 2a (`Ohr Zarua, Volume I 1:1`) **V-TOC/V-LNK** | Topic-arranged | | | Fetch it through links |
| Rav Nissim Gaon | `Rav Nissim Gaon on Berakhot` / `Rav Nissim Gaon` **V-TOC** | Berakhot, Shabbat, Eruvin **V-TOC** | | | |
| Rabbeinu Gershom | `Rabbeinu Gershom on <T>` / `Rabbeinu Gershom` **V-TOC** | 11: Taanit, BB, Makkot, Menachot, Chullin, Bekhorot, Arakhin, Temurah, Keritot, Meilah, Tamid. **No Berakhot** **V-TOC** | | | |
| *Also on Sefaria for Berakhot* | `HaMaor HaKatan on Berakhot` (CT **`HaMaor`**), `Katuv Sham on Berakhot`, `Shiltei HaGiborim on Berakhot`, `Hagahot Chavot Yair on Berakhot`, `Chiddushei Anshei Shem on Berakhot`, `Hagahot MeAlfas Yashan on Berakhot`, `Piskei Tosafot on Berakhot` **V-TOC** | Mostly the Rif-cycle tractates (about 19–26) | | | |

## 3. Acharonim

| Work | Sefaria index title / `collectiveTitle` | Shas coverage on Sefaria | Other text sources | Notes |
|---|---|---|---|---|
| Maharsha, halakhic novellae | `Chidushei Halachot on Berakhot` / **`Chidushei Halachot`**. Author: "Shmuel Eidels (Maharsha)" **V-IDX** | 31 indexes (30 tractates, plus `Chidushei Halachot on Yevamot; Alternate Version`) **V-TOC** | he.wikisource `מהרש"א_על_הש"ס/ברכות/פרק_א` **V-WS** | **The name "Maharsha" never appears as a title or CT.** Match by CT, or by the author slug `maharsha`. |
| Maharsha, aggadic novellae | `Chidushei Agadot on Berakhot` / **`Chidushei Agadot`** **V-LNK** | All 37 **V-TOC** | jewishbooks wiki, one page per amud: `מהרש"א_-_חידושי_אגדות/ברכות/לה/ב` **V-WS** | Spelled "Agadot" with one g |
| Maharshal | `Chokhmat Shlomo on Berakhot` / `Chokhmat Shlomo` **V-TOC/V-LNK** | 19 tractates **V-TOC** | he.wikisource `מהרש"ל_על_הש"ס/ברכות/פרק_א` **V-WS** | Spelled "Chokhmat", not "Chochmat". The TOC also has `Yam shel Shelomoh` on 5 tractates. |
| Maharam Lublin | `Maharam on <T>` / CT **`Maharam`**. Author: "Maharam Lublin" **V-IDX** (Niddah) | 17 tractates. **No Berakhot** **V-TOC** | | Name gotcha: the CT is plain "Maharam" |
| Maharam Schiff | `Maharam Schiff on <T>` / `Maharam Schiff` **V-TOC** | 12 tractates. No Berakhot **V-TOC** | | |
| Pnei Yehoshua | `Penei Yehoshua on Berakhot` / **`Penei Yehoshua`** **V-TOC/V-LNK** | 16 tractates **V-TOC** | he.wikisource `פני_יהושע/ברכות/פרק_א` **V-WS** | Spelled "Penei" |
| R. Akiva Eiger | `Chiddushei Rabbi Akiva Eiger on Berakhot` / `Chiddushei Rabbi Akiva Eiger` **V-TOC/V-LNK** | 26 tractates **V-TOC** | | Separate from `Gilyon HaShas` |
| Tzlach (Noda BiYehudah) | `Tziyyun LeNefesh Chayyah on Berakhot` / CT **`Tzelach`** **V-IDX** | 10: Berakhot, Shabbat, Eruvin, RH, Taanit, Megillah, Chagigah (CT `Tzelach`), plus Zevachim, Menachot, Chullin **with no CT at all**. **No Pesachim** **V-TOC** | he.wikisource (UNVERIFIED) | Two name gotchas: the title is "Tziyyun LeNefesh Chayyah", and the CT "Tzelach" is missing on 3 indexes |
| Hafla'ah | `Haflaah on Ketubot` / CT **`Haflaah on Ketubot`** **V-TOC** | Ketubot only | | No Berakhot |
| Chatam Sofer on Shas | `Chidushei Chatam Sofer on <T>` / `Chidushei Chatam Sofer` **V-TOC** | 16 tractates. **No Berakhot**. There is also `Chidushei Chatam Sofer on Jerusalem Talmud Berakhot` **V-TOC** | Wikisource "אחרונים על ש"ס בבלי" category mentions it (search summary) | |
| Aruch LaNer | `Arukh LaNer on Rosh Hashanah` / `on Sanhedrin` / CT `Arukh LaNer` **V-TOC** | RH, Sanhedrin | | No Berakhot. Spelled "Arukh" |
| Sfat Emet on Shas | **None**. `Sefat Emet` on Sefaria is the Chasidic Torah work **V-TOC** | – | UNVERIFIED | Link-only. Do not confuse with `Sefat Emet`. |
| Rashash | `Rashash on Berakhot` / `Rashash` **V-TOC/V-LNK** | 36 tractates **V-TOC** | | |
| Ya'avetz | `Haggahot Ya'avetz on Berakhot` / `Haggahot Ya'avetz` **V-TOC/V-LNK** | 36 tractates **V-TOC** | | Spelled "Haggahot" with double g |
| Maharatz Chajes | **None on the Gemara**. Sefaria has `Annotations of Maharatz Chajes on Mishneh Torah, …` and `Mevo HaTalmud (Chajes)` **V-TOC/V-IDX** | – | Vilna back matter (UNVERIFIED) | Glosses on Shas: link-only |
| Reshimot Shiurim (R. Soloveitchik) | `Reshimot Shiurim on Berakhot` / `Reshimot Shiurim` **V-TOC/V-LNK** | 10: Berakhot, Sukkah, Yevamot, Nedarim, Kiddushin, BK, BM, Shevuot, Horayot, Sanhedrin **V-TOC** | AlHaTorah `shas.alhatorah.org/Parshan/Reshimot_Shiurim/Nedarim/2a.1` **V-WS** | **CC-BY-NC** (New York, 2012) **V-VER** |
| Ketzot HaChoshen / Netivot HaMishpat | `Ketzot HaChoshen on Shulchan Arukh, Choshen Mishpat`; `Netivot HaMishpat, Beurim …` and `… Hidushim on Shulchan Arukh, Choshen Mishpat` **V-TOC** | Arranged by Shulchan Arukh section, not by daf | | Reach them through links, if any exist |
| Avnei Miluim | **None** **V-TOC** | – | he.wikisource page `אבני_מילואים`; Dicta `library.dicta.org.il/categories/Halakha and Minhaggim/avneimiluim`; jewishbooks wiki `אבני_מילואים/אבן_העזר/עא` **V-WS** | Text exists outside Sefaria |
| R. Chaim on the Rambam | **None** **V-TOC** | – | he.wikisource `חידושי_רבינו_חיים_הלוי`; jewishbooks wiki `חידושי_רבנו_חיים_הלוי/יסודי_התורה/ה` **V-WS** | Scans: HebrewBooks 39831 and 61915 **V-WS**. Author died 1918 (**V-WS**, from the HebrewBooks author dates) |
| Sha'arei Yosher | **None** **V-TOC** | – | Dicta `library.dicta.org.il/authors/Shimon Shkop/shaareiyosher2` **V-WS** | |
| Kovetz Shiurim | **None**. Do not confuse with `Kovetz Yesodot VaChakirot` (Reference) **V-TOC** | – | No text source found | Commercial reprints are on sale **V-WS**. Author died 1941 (**V-WS**, HebrewBooks author dates). Treat as link-only. |
| Birkat Shmuel | **None** **V-TOC** | – | No text source found | Link-only |
| *Other Acharonim on Sefaria for Berakhot* | `Marit HaAyin on Berakhot` (37 tractates), `Petach Einayim on Berakhot` (37), `Sha'arei Torat Bavel on Berakhot` (46 incl. minor tractates; R. Z.W. Rabinowitz, 1961) **V-TOC/V-IDX** | | | |

## 4. Aggadah

| Work | Sefaria | Coverage | Other sources | Notes |
|---|---|---|---|---|
| Ein Yaakov (base text) | `Ein Yaakov` (Midrash/Aggadah). One complex index with a node per tractate; refs look like `Ein Yaakov, Berakhot 1:1` (Chapter:Paragraph) **V-IDX** | All tractates. **Node names differ from the Bavli titles:** `Eiruvin`, `Pesakhim`, `Khagigah`, `Ketubbot`, `Zevakhim`, `Menakhot`, `Khullin` **V-IDX** | he.wikisource `עין_יעקב/ברכות/פיסקא_ח` **V-WS** | Hebrew "Daat" version: PD. English: Glick 1916–21, PD **V-VER**. **Links to the daf are sparse:** only 4 Ein Yaakov→Berakhot links in all of chapter 1, and none on 5a **V-LNK**. The app needs its own mapping. |
| Etz Yosef, Anaf Yosef, Iyun Yaakov, HaKotev (on Ein Yaakov) | **None**. `Etz Yosef` exists only on Midrash Rabbah **V-TOC** | – | The he.wikisource Ein Yaakov pages reportedly carry Etz Yosef and Iyun Yaakov (search summary, UNVERIFIED) | Link-only unless the Wikisource pages are confirmed |
| Ben Yehoyada | `Ben Yehoyada on Berakhot` / `Ben Yehoyada` **V-TOC/V-LNK** | 34 tractates **V-TOC** | he.wikisource `בן_יהוידע/ברכות/פרק_א` **V-WS** | |
| Benayahu | `Benayahu on Berakhot` / `Benayahu` **V-TOC/V-LNK** | 12: Berakhot through Chagigah **V-TOC** | | |
| Maharal, Chiddushei Aggadot | **None** **V-TOC** | – | he.wikisource `חידושי_אגדות_(מהר"ל)` **V-WS** | Link-only |
| Maharal, Be'er HaGolah / Netzach Yisrael | `Be'er HaGolah`, `Netzach Yisrael` (Jewish Thought/Acharonim/Maharal). Also: Netivot Olam, Gevurot Hashem, Tiferet Yisrael, Derush al HaTorah, Drashot, Ner Mitzvah, with Hartman notes **V-TOC** | Arranged by topic. Some are linked to the daf (for example, Be'er HaGolah and Netivot Olam on 5a) **V-LNK** | | Do not confuse `Be'er HaGolah` (Maharal) with `Be'er HaGolah on Shulchan Arukh, …` |
| Rav Kook, Ein Ayah | `Ein Ayah`. **CT is empty ("")**. Structure: Chapter:Section:Comment. base_text_titles = Berakhot and Shabbat **V-IDX** | Berakhot and Shabbat, in one index | Sefaria's versions come from he.wikisource ("Ein Ayah Wikitext") and "Rav Kook Digitized Texts" **V-VER** | License "unknown" and "CC-BY-SA" **V-VER**. **Not linked to Berakhot dapim.** Links from Ein Ayah 1–2 go to Shabbat and Tanakh, none to Berakhot 2a or 5a **V-LNK**. How chapters map to tractates is unclear. Use with care. |
| Petach Einayim (Chida) | `Petach Einayim on Berakhot` / `Petach Einayim` **V-LNK** | 37 **V-TOC** | | |
| Rashba, Perush HaHaggadot | **None** **V-TOC** | – | No text source found. HebrewBooks has Chiddushei HaRashba Berakhot (42067); whether it includes the Haggadot is UNVERIFIED | Link-only |

## 5. Tools, reference works, Yerushalmi

| Work | Sefaria | Other sources | Copyright / status |
|---|---|---|---|
| Steinsaltz | `Steinsaltz on Berakhot` / `Steinsaltz`. All 37 tractates **V-TOC** | steinsaltz.org / Steinsaltz Center app **V-WS** | Sefaria Hebrew = "William Davidson Edition – Hebrew", **CC-BY-NC**. The English "Sefaria Community Translation" is CC0 **V-VER**. The Gemara's own English (Koren Noé) is CC-BY-NC **V-VER**. **Anything outside the Sefaria/Davidson edition (other Koren volumes, the Steinsaltz Center) is copyrighted: link only.** |
| Jastrow | `Jastrow` (Reference/Dictionary). 21 links on 2a **V-LNK** | | London 1903, **Public Domain** **V-VER** |
| Aruch / Aruch HaShalem | `Sefer HeArukh`, plus `Hafla'ah ShebaArakhin on Sefer HeArukh` **V-TOC/V-LNK**. **No Aruch HaShalem** **V-TOC** | Aruch HaShalem scan: archive.org `arukh-hashalem-vienna-1892-images` **V-WS** | Aruch HaShalem: scan only. Also on Sefaria: `A Dictionary of the Talmud` **V-LNK** |
| Encyclopedia Talmudit | **None** **V-TOC** | Bar-Ilan Responsa (subscription); new entries on Wikishiva (search summary) | **In copyright: link only** |
| Yad Malachi | **None** **V-TOC** | jewishbooks wiki `יד_מלאכי/כללי_התלמוד/ז` **V-WS** | Scans: HebrewBooks 14122 and 32532 **V-WS** |
| Mevo HaTalmud | Only `Mevo HaTalmud (Chajes)` (Guides), linked from 2a and 5a **V-IDX/V-LNK**. The Mevo HaTalmud attributed to Shmuel HaNagid (printed at the end of Berakhot) is **not** on Sefaria **V-TOC** | | Other Guides on Sefaria: `Darkhei HaTalmud`, `Introductions to the Babylonian Talmud` **V-TOC** |
| Hachi Garsinan (Friedberg) | Not on Sefaria. Sefaria's MCP does have a manuscript-image tool (`get_available_manuscripts`), not tested | `bavli.genizah.org`: free but needs registration; there is a mobile app **V-WS** | No public API found. **Link only** |
| Dikdukei Soferim | **None** **V-TOC** | HebrewBooks 38512 (vol. 1: Berakhot and Zeraim) **V-WS** | 1867–97; PD by age (UNVERIFIED). Scan only |
| Otzar HaGeonim | **None**. Sefaria has `Teshuvot HaGeonim` and 3 other Geonic responsa collections **V-TOC** | HebrewBooks 38274 (Berakhot) **V-WS** | B.M. Lewin, 1879–1944 **V-WS**. Scan only |
| Iggeret Rav Sherira Gaon | `Epistle of Rav Sherira Gaon` (Responsa/Geonim), linked from 2a **V-TOC/V-LNK** | | Fetchable |
| Yerushalmi | `Jerusalem Talmud Berakhot` **V-TOC** | | |
| Pnei Moshe | `Penei Moshe on Jerusalem Talmud Berakhot` / CT `Penei Moshe` **V-TOC** | | 39 tractates **V-TOC** |
| Korban HaEdah | `Korban HaEdah on Jerusalem Talmud <T>` / CT `Korban HaEdah` **V-TOC** | | 22 tractates. **No Zeraim, so none on Berakhot** **V-TOC**. For Yerushalmi Berakhot, use Penei Moshe or `Mareh HaPanim on Jerusalem Talmud Berakhot`. |

## 6. Non-Sefaria text sources (URL patterns)

| Source | What it has | URL pattern | Machine access | Status |
|---|---|---|---|---|
| Hebrew Wikisource | Daf pages; per-chapter pages for many commentaries | `https://he.wikisource.org/wiki/ברכות_ב_א`; `…/בבלי_ברכות`; `…/<Work>_על_הש"ס/ברכות/פרק_א` (Maharsha, Maharshal, Meiri, Tosafot, Tosafot HaRosh, Rashba); `…/פני_יהושע/ברכות/פרק_א`; `…/רבינו_אשר_על_הש"ס/פסקי_הרא"ש/ברכות/פרק_א`; `…/עין_יעקב/ברכות/פיסקא_N`; `…/בן_יהוידע/ברכות/פרק_א`; categories `קטגוריה:ראשונים_על_ש"ס_בבלי` and `קטגוריה:אחרונים_על_ש"ס_בבלי` **V-WS** | Standard MediaWiki API (`/w/api.php?action=parse&page=…&prop=wikitext`). This is UNVERIFIED because the domain is blocked in this sandbox. | CC-BY-SA (Sefaria's label for Wikisource text **V-VER**). Needs attribution and a markup parser. |
| AlHaTorah, Shas HaMeforash | Gemara with Rashi, Tosafot, Rif, Ritva, R. Chananel, Maharsha, Steinsaltz, Aruch al seder HaShas, Reshimot Shiurim, Seridei Esh, and more **V-WS** (commentary names come from search snippets) | `https://shas.alhatorah.org/Berakhot/2a`; `…/Parshan/Reshimot_Shiurim/Nedarim/2a.1` **V-WS** | No public API known (UNVERIFIED) | **Link only** |
| jewishbooks wiki (אוצר הספרים היהודי השיתופי) | Maharsha Chidushei Agadot (per amud), Yad Malachi, R. Chaim, Avnei Miluim | `https://wiki.jewishbooks.org.il/mediawiki/wiki/מהרש"א_-_חידושי_אגדות/ברכות/ה/ב`; `פורטל:מסכת_ברכות` **V-WS** | MediaWiki (UNVERIFIED) | License not checked |
| Dicta library | OCR'd books, including Sha'arei Yosher and Avnei Miluim | `https://library.dicta.org.il/authors/<Author>/<book>` **V-WS** | GitHub `Dicta-Israel-Center-for-Text-Analysis/Dicta-Library-Download`: `books.json` with `textFileURL` (repo exists **V-WS**; the books.json details come from a search summary, UNVERIFIED) | Reported as CC BY-SA 4.0 (search summary, UNVERIFIED) |
| Daat | Hebrew Ein Yaakov (the source of Sefaria's version) **V-VER** | – | – | PD per Sefaria **V-VER** |
| HebrewBooks | Vilna Shas page scans, plus scans of most works above | `https://hebrewbooks.org/shas.aspx?mesechta=1&daf=2&format=pdf` (amud b: `daf=2b`); books `https://hebrewbooks.org/<id>` **V-WS** | PDF only | **Scan / link only** |
| archive.org | Aruch HaShalem | `https://archive.org/details/arukh-hashalem-vienna-1892-images` **V-WS** | Scan | Link only |
| NLI | Piskei Riaz Berakhot manuscript | `nli.org.il/en/manuscripts/NNL_ALEPH990000858880205171/NLI` **V-WS** | Image | Link only |
| Schottenstein (ArtScroll) | English Talmud | artscroll.com digital library **V-WS** | Proprietary app, single user **V-WS** | **Copyrighted: link only** |

## 7. Exact Sefaria names to match (gotchas)

| Common name | Sefaria title pattern | `collectiveTitle.en` |
|---|---|---|
| Maharsha (halakha) | `Chidushei Halachot on X` | `Chidushei Halachot` |
| Maharsha (aggadah) | `Chidushei Agadot on X` | `Chidushei Agadot` |
| Maharshal | `Chokhmat Shlomo on X` | `Chokhmat Shlomo` |
| Maharam Lublin | `Maharam on X` | `Maharam` |
| Pnei Yehoshua | `Penei Yehoshua on X` | `Penei Yehoshua` |
| Tzlach | `Tziyyun LeNefesh Chayyah on X` | `Tzelach` (missing on Zevachim, Menachot, Chullin) |
| R. Akiva Eiger | `Chiddushei Rabbi Akiva Eiger on X` (and separately `Gilyon HaShas on X`) | same as the title stem |
| Ya'avetz | `Haggahot Ya'avetz on X` | `Haggahot Ya'avetz` |
| Ramban | `Chiddushei Ramban on X` | `Chiddushei Ramban` |
| Ra'ah (Berakhot) | `Chiddushei HaRa'ah on Berakhot` | `Ra'ah` (Ketubot: `Chiddushei HaRa'ah`) |
| Talmidei R. Yonah | `Rabbeinu Yonah on Berakhot` | `Rabbeinu Yonah` |
| Rif | `Rif X` (no "on") | `Rif` |
| Baal HaMaor | `HaMaor HaKatan on X` / `HaMaor HaGadol on X` | `HaMaor` |
| Shita Mekubetzet | `Shita Mekubetzet on X`, but `Shita Mekubbetzet on Nedarim/Nazir` | `Shita Mekubetzet` |
| Hafla'ah | `Haflaah on Ketubot` | `Haflaah on Ketubot` |
| Aruch LaNer | `Arukh LaNer on X` | `Arukh LaNer` |
| Mordechai | `Mordechai on Bava Batra` | `Mordechai on Bava Batra` |
| Rashba on Menachot | `Rashba on Menachot` | `Rashba (Attributed)` |
| Or Zarua | `Ohr Zarua` | (none; Halakhah) |
| Ein Ayah | `Ein Ayah` | `""` (empty) |
| Ein Yaakov tractates | `Ein Yaakov, Pesakhim / Eiruvin / Khagigah / Ketubbot / Zevakhim / Menakhot / Khullin …` | – |
| Mevo HaTalmud | `Mevo HaTalmud (Chajes)` | – |
| Iggeret Rav Sherira | `Epistle of Rav Sherira Gaon` | – |
