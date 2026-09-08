# -*- coding: utf-8 -*-
"""Verbatim Sefaria text for the opening of Berakhot 2a.

This exists so the rest of the system can be run and tested without network
access. It is a TRANSCRIPTION, not an authority: treat any pack built from it
as fixture data only, and rebuild from the API with build_pack.py before a
single word of it is shown to a learner. verify_pack.py diffs a pack against
live Sefaria and is the check that this file has not drifted or been mistyped.

Source: sefaria.org, William Davidson Edition (CC BY-NC) and Vilna Edition.
"""

DAF = "Berakhot 2a"

# Vocalized Davidson. The punctuation is the printed stopping points.
SOURCE = [
    "<big><strong>מֵאֵימָתַי</strong></big> קוֹרִין אֶת שְׁמַע בָּעֲרָבִין? מִשָּׁעָה שֶׁהַכֹּהֲנִים נִכְנָסִים לֶאֱכוֹל בִּתְרוּמָתָן. עַד סוֹף הָאַשְׁמוּרָה הָרִאשׁוֹנָה. דִּבְרֵי רַבִּי אֱלִיעֶזֶר.",
    "וַחֲכָמִים אוֹמְרִים: עַד חֲצוֹת.",
    "רַבָּן גַּמְלִיאֵל אוֹמֵר עַד שֶׁיַּעֲלֶה עַמּוּד הַשַּׁחַר.",
]

# Davidson English. Bold marks the words literally on the daf.
ENGLISH = [
    "<b>From when,</b> that is, from what time, does <b>one recite <i>Shema</i> in the evening? From the time when the priests enter to partake of their <i>teruma.</i></b> Until when does the time for the recitation of the evening <i>Shema</i> extend? <b>Until the end of the first watch.</b> The term used in the Torah (Deuteronomy 6:7) to indicate the time for the recitation of the evening <i>Shema</i> is <i>beshokhbekha</i>, when you lie down, which refers to the time in which individuals go to sleep. <b>That is the statement of Rabbi Eliezer.</b>",
    "<b>The Rabbis say:</b> The time for the recitation of the evening <i>Shema</i> is <b>until midnight.</b>",
    "<b>Rabban Gamliel says:</b> One may recite <i>Shema</i> <b>until dawn,</b> indicating that <i>beshokhbekha</i> is to be understood as a reference to the entire time people sleep in their beds, the whole night.",
]

# ref -> (category, index title, hebrew body)
COMMENTS = [
    ("Rashi on Berakhot 2a:1:1", "Commentary", "Rashi on Berakhot 2a",
     "מאימתי קורין את שמע בערבין. משעה שהכהנים נכנסים לאכול בתרומתן – כהנים שנטמאו וטבלו והעריב שמשן והגיע עתם לאכול בתרומה:"),
    ("Rashi on Berakhot 2a:1:2", "Commentary", "Rashi on Berakhot 2a",
     "עד סוף האשמורה הראשונה – שליש הלילה כדמפרש בגמרא (דף ג.) ומשם ואילך עבר זמן דלא מקרי תו זמן שכיבה ולא קרינן ביה בשכבך ומקמי הכי נמי לאו זמן שכיבה לפיכך הקורא קודם לכן לא יצא ידי חובתו. אם כן למה קורין אותה בבית הכנסת כדי לעמוד בתפלה מתוך דברי תורה והכי תניא בבריי' בברכות ירושלמי. ולפיכך חובה עלינו לקרותה משתחשך. ובקריאת פרשה ראשונה שאדם קורא על מטתו יצא:"),
    ("Tosafot on Berakhot 2a:1:1", "Commentary", "Tosafot on Berakhot 2a",
     "מאימתי קורין וכו' – פי' רש\"י ואנן היכי קרינן מבעוד יום ואין אנו ממתינין לצאת הכוכבים כדמפרש בגמרא על כן פירש רש\"י שקריאת שמע שעל המטה עיקר והוא לאחר צאת הכוכבים. והכי איתא בירושלמי אם קרא קודם לכן לא יצא ואם כן למה אנו מתפללין קריאת שמע בבית הכנסת כדי לעמוד בתפלה מתוך דברי תורה. תימא לפירושו והלא אין העולם רגילין לקרות סמוך לשכיבה אלא פרשה ראשונה (לקמן ברכות דף ס:) ואם כן שלש פרשיות היה לו לקרות. ועוד קשה דצריך לברך בקריאת שמע שתים לפניה ושתים לאחריה בערבית. ועוד דאותה קריאת שמע סמוך למטה אינה אלא בשביל המזיקין כדאמר בסמוך (דף ה.) ואם תלמיד חכם הוא אינו צריך. ועוד קשה דא\"כ פסקינן כרבי יהושע בן לוי דאמר תפלות באמצע תקנום. ואנן קיי\"ל כר' יוחנן דאמר לקמן (ברכות דף ד:) איזהו בן העולם הבא זה הסומך גאולה של ערבית לתפלה. לכן פי' ר\"ת דאדרבה קריאת שמע של בית הכנסת עיקר. ואם תאמר היאך אנו קורין כל כך מבעוד יום. ויש לומר דקיימא לן כרבי יהודה דאמר בפרק תפלת השחר (ברכות דף כו.) דזמן תפלת מנחה עד פלג המנחה ומיד כשיכלה זמן המנחה מתחיל זמן ערבית. על כן אומר ר\"י דודאי קריאת שמע של בית הכנסת עיקר ואנו שמתפללין ערבית מבעוד יום סבירא לן כהני תנאי דגמרא דאמרי משעה שקדש היום. ומכאן נראה מי שקורא ק\"ש על מטתו שאין לברך וגם אינו צריך לקרות אלא פרשה ראשונה:"),
    ("Steinsaltz on Berakhot 2a:1", "Commentary", "Steinsaltz on Berakhot 2a",
     "ראשיתה של מסכת ברכות — ראשונה לכל המסכתות שבששת הסדרים — היא בענין קריאת שמע, שיש בה קבלת עול מלכות שמים וקבלת עול מצוות. ופותחים בדיני זמן קריאת שמע: <b>מאימתי</b> (ממתי, מאיזו שעה) מתחיל הזמן בו <b>קורין</b> <b>את</b> קריאת <b>שמע בערבין</b>? <b>משעה שהכהנים</b> הטמאים שנטהרו <b>נכנסים לאכול בתרומתן.</b> ועד מתי הוא זמן קריאת שמע של ערבית? <b>עד סוף האשמורה הראשונה</b> של הלילה, אלו <b>דברי ר' אליעזר.</b>"),
]

# Ein Mishpat and cross-references carried on segment 1.
HALACHA = ["Mishneh Torah, Reading the Shema 1:9", "Tur, Orach Chayim 235",
           "Shulchan Arukh, Orach Chayim 235:1", "Sefer Mitzvot Gadol, Positive Commandments 18"]
XREFS = ["Deuteronomy 6:7", "Berakhot 4a-10a", "Berakhot 13a:15", "Mishnah Berakhot 1:1"]
