#!/usr/bin/env node
/*
 * generate-events.js
 * --------------------------------------------------------------
 * Reads the PUBLIC iCal feed for the CrashSpace calendar (no API
 * key required, ever) and writes a clean events.json that index.html
 * loads from the same origin. No secret touches the browser.
 *
 * Usage:
 *   npm install          # installs node-ical (see package.json)
 *   node generate-events.js
 *
 * Schedule it (cron / GitHub Action / serverless cron) to refresh.
 * --------------------------------------------------------------
 */

const fs = require("fs");
const path = require("path");
const ical = require("node-ical");

// Public iCal URL for the calendar (calendar ID is URL-encoded).
const ICS_URL =
  "https://calendar.google.com/calendar/ical/crashspacela%40gmail.com/public/basic.ics";

// How far back/forward to include events (days).
const PAST_DAYS = 1;
const FUTURE_DAYS = 90;

const OUT_FILE = path.join(__dirname, "events/events.json");

const DAY = 24 * 60 * 60 * 1000;

function dateKey(d) {
  // YYYY-MM-DD in UTC — used to match EXDATE / recurrence overrides
  return d.toISOString().slice(0, 10);
}

/**
 * Flatten a node-ical VEVENT into the plain JSON shape index.html consumes.
 *
 * For one-off events, ev.start/ev.end are used directly. For recurring events,
 * the caller passes the specific occurrence's times via startOverride/endOverride,
 * since every instance shares one master VEVENT but lands on a different date.
 *
 * Times are emitted as ISO strings (the browser formats them); allDay is derived
 * from iCal's date-vs-datetime distinction; id combines uid + start so repeated
 * instances of a recurring event stay unique.
 *
 * @param {object} ev            Parsed VEVENT from node-ical.
 * @param {Date}  [startOverride] Occurrence start (recurring events only).
 * @param {Date}  [endOverride]   Occurrence end (recurring events only).
 * @returns {object} { id, title, start, end, allDay, location, description, url }
 */
function normalize(ev, startOverride, endOverride) {
  const start = startOverride || ev.start;
  const end = endOverride || ev.end;
  const allDay = ev.datetype === "date";
  return {
    id: (ev.uid || "") + "@" + start.toISOString(),
    title: (ev.summary || "Untitled").toString().trim(),
    start: start.toISOString(),
    end: end ? end.toISOString() : null,
    allDay,
    location: ev.location ? ev.location.toString().trim() : "",
    description: ev.description
      ? ev.description.toString().replace(/\s+/g, " ").trim()
      : "",
    url: ev.url ? ev.url.toString() : "",
  };
}

async function main() {
  const rangeStart = new Date(Date.now() - PAST_DAYS * DAY);
  const rangeEnd = new Date(Date.now() + FUTURE_DAYS * DAY);

  console.log("Fetching", ICS_URL);
  const res = await fetch(ICS_URL);
  if (!res.ok) throw new Error(`Feed returned HTTP ${res.status}`);
  const text = await res.text();

  const data = ical.parseICS(text);
  const out = [];

  for (const key in data) {
    const ev = data[key];
    if (!ev || ev.type !== "VEVENT") continue;

    if (ev.rrule) {
      // Recurring event: expand occurrences within the window.
      const duration = ev.end ? ev.end - ev.start : 0;
      const occurrences = ev.rrule.between(rangeStart, rangeEnd, true);

      for (const occ of occurrences) {
        const k = dateKey(occ);

        // Skip explicitly excluded dates.
        if (ev.exdate && ev.exdate[k]) continue;

        // Honor single-instance overrides (moved/edited occurrences).
        if (ev.recurrences && ev.recurrences[k]) {
          const o = ev.recurrences[k];
          out.push(normalize(o, o.start, o.end));
          continue;
        }

        const start = new Date(occ);
        const end = new Date(occ.getTime() + duration);
        out.push(normalize(ev, start, end));
      }
    } else {
      // One-off event.
      if (ev.start >= rangeStart && ev.start <= rangeEnd) {
        out.push(normalize(ev));
      }
    }
  }

  out.sort((a, b) => new Date(a.start) - new Date(b.start));

  const payload = {
    calendar: "CrashSpace LA",
    generated: new Date().toISOString(),
    count: out.length,
    events: out,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${out.length} events to ${OUT_FILE}`);
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
