The values of `"issueToken"`, `"cookies"` and `"apiKey"` are specific to your Google Account. To get them, follow these steps (only needs to be done once, as long as you stay logged into your Google Account).

1. Open a Chrome browser tab in Incognito Mode (or clear your cache).
2. Open Developer Tools (View/Developer/Developer Tools).
3. Click on 'Network' tab. Make sure 'Preserve Log' is checked.
4. In the 'Filter' box, enter `issue`.
5. Go to `home.nest.com`, and click 'Sign in with Google'. Log into your account.
6. Click on the last `iframerpc` call.
7. In the Headers tab, under General, copy the entire `Request URL` (beginning with `https://accounts.google.com`, ending with `nest.com`). This is your `"issueToken"` in `config.json`.
8. In the Headers tab, under Request Headers, copy the entire `cookie` (**include the whole string which is several lines long and has many field/value pairs**). This is your `"cookies"` in `config.json`.
9. Click on the last `issue_jwt` call.
10. In the Headers tab, under Request Headers, copy the entire `x-goog-api-key`. This is your `"apiKey"` in `config.json`.
11. Do not log out of `home.nest.com`, as this will invalidate your credentials. Just close the browser tab.