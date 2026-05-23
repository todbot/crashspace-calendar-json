# crashspace-calendar


Genarate a JSON file from a public Google Calendar ical .ics feed

To use:

```
npm install
npm run build
```

The result is stored in `events/events.json`. 

Test out the result with:
- `python3 -m http.server 8000`
- visiting http://localhost:8000/demo.html in a browser.

