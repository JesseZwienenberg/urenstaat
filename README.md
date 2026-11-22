# Uurwerk

A small installable web app (PWA), called **Uurwerk** on the phone, that turns a Google Maps Timeline export into a weekly timesheet PDF: hours per job number (werknummer) and the materials used. Built for one self-employed carpenter on an Android phone. The interface is in Dutch.

Everything is stored on the phone (IndexedDB). There is no server and no account. The only network request the app makes is the address search (OpenStreetMap Nominatim), which sends the typed address and nothing else.

## How it works

1. **Kies week** – defaults to the current ISO week.
2. **Importeer Tijdlijn** – pick the exported JSON file, or share it into the app from Android. Only the selected week is used; importing the same file again changes nothing.
3. **Controleer uren** – each workday gets a proposal of 8 in half-hour steps, split over the locations visited.
4. **Vul materialen in** – materials per job number, each with an amount in free text ("3", "12 m"). Type to search the list; a name that is not in it yet is added. "Kopieer van vorige week" copies the lines without their amounts.
5. **Maak document** – a preview, then `Urenstaat week [nr] [jaar].pdf`, shared through the Android share sheet or saved. "Kopieer als tekst" copies the same content as tab-separated text, for changes the app cannot make.

### Hour rules

- Time at a work location counts for that location, and so does the travel **towards** it (everything driven since the previous stay, same day). Travel home does not count.
- Only time between 06:00 and 17:00 counts (setting), except at regie locations.
- A visit is matched to the nearest active location within its radius (default 150 m). Other places are ignored; those visited during working hours are listed under "Onbekende plekken".
- A place from that list can be marked as **private** (home: never counts, no longer listed) or as **work without a job number** (builders' merchant, workshop: the time there and the drive to it count for the next job that day).
- Stays shorter than 15 minutes are ignored (setting).
- A workday is 8 hours (setting), in steps of half an hour. With several locations the hours are split in proportion to the measured time. A location with at least 20 measured minutes gets at least 1 hour; shorter ones are dropped.
- A location marked **Altijd regie** (paid per hour) gets its measured time rounded up to a half hour, including time outside working hours. Just over the workday (by less than 30 minutes) stays the workday: 8 h 20 min → 8, 8 h 40 min → 9. Other locations that day share what is left of the 8 hours.
- Part of a day at a location can be marked as regie ("Gedeeltelijk regie"). On the timesheet that part gets its own row, with "(regie)" after the address.
- When a location has no address, the timesheet shows its name in the address column.
- Saturday and Sunday are never filled in automatically. They can be added by hand.
- Days edited by hand are kept when a file is imported again.
- All day boundaries use Europe/Amsterdam time, including daylight saving time.

## Development

```
npm install
npm run dev      # local development
npm test         # unit tests (parser, matching, hour rules, PDF)
npm run build    # type check + production build in dist/
```

Code layout:

- `src/lib/timeline/parser.ts` – Timeline export parser
- `src/lib/hours.ts` – measuring and the 8-hour proposal
- `src/lib/geo.ts`, `tz.ts`, `week.ts`, `format.ts` – distance, time zone, ISO weeks, Dutch formats
- `src/lib/pdf.ts` – the PDF
- `src/lib/db.ts` – IndexedDB, backup and restore
- `src/screens/` – the screens
- `public/sw.js` – offline cache and Android share target

### About the sample export

`tests/fixtures/sample-timeline.json` is **made up** (see `scripts/make-sample.mjs`). It follows the layout the Android export is known to use, but it has not been compared with a real file from this phone. Import a real export once and check the result before relying on the app.

### Updates and the offline copy

`public/sw.js` keeps an offline copy of the app. A new version is stored in full, past the browser's HTTP cache, and only used once its start page matches its own files. If the app still fails to load its files, a small script in `index.html` drops the offline copy and loads the app again; saved data stays.

If the app ever shows a blank screen after an update: close it and open it again (twice if needed). **Do not clear the site data in Chrome**: that also deletes all saved locations, weeks and materials. Make a backup now and then (Instellingen → Maak back-up).

## Deploying for free

### GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds and publishes on every push to `main`.

1. On a free GitHub plan, Pages only works for **public** repositories: Settings → General → Change repository visibility → Public. (The code contains no personal data.)
2. Settings → Pages → Source: **GitHub Actions**.
3. Actions → "Deploy to GitHub Pages" → Run workflow.
4. The app is then at `https://<username>.github.io/<repository>/`.

### Netlify (works with a private repository)

1. Sign in at netlify.com with GitHub → Add new site → Import an existing project → pick this repository.
2. Build command `npm run build`, publish directory `dist`.

## Installing on the Android phone

1. Open the app's address in **Chrome**.
2. Menu (⋮) → **Toevoegen aan startscherm** / **App installeren** → Installeren.
3. Open the app from the home screen, go to **Instellingen** and fill in the name and company.
4. Add the work locations under **Locaties**.

After installing through Chrome, "Urenstaat" also appears in the Android share sheet, so the Timeline file can be shared straight into the app from the Files app.

Make a backup now and then (Instellingen → Maak back-up): the data lives only on the phone.
