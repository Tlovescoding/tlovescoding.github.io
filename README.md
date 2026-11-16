# Inkwell – fanfiction site with email sign-up

Write and read fanfiction with chapters, tags, search, likes and comments. Readers set their name, last name, eye
color and hair color once, and Y/N, Y/L/N, E/C and H/C in any story become theirs.

## Run it on your computer
1. Install Node.js 18+ from nodejs.org.
2. In this folder: `npm install` then `npm start`.
3. Open http://localhost:3000. Without email settings, confirmation links are printed in the terminal window.

## Real confirmation emails
Set these environment variables (get SMTP details from an email service such as Brevo, Resend, Mailgun or SendGrid):
- `SMTP_URL`  e.g. `smtps://username:password@smtp.example.com:465`
- `MAIL_FROM` e.g. `Inkwell <hello@yourdomain.com>` (the address must be verified with your email service)
- `BASE_URL`  your public address, e.g. `https://inkwell.example.com`

## Put it online
Use any host that runs Node and has a **persistent disk** (the data lives in one SQLite file, `inkwell.db`):
Render, Railway or Fly.io all work. Set the variables above, run `npm install` as the build step and `npm start`
as the start command, and point `DB_PATH` at the persistent disk. Use https, since login cookies are marked secure there.

## Not included yet
Password reset, moderation/reporting tools, and automatic backups (copy `inkwell.db` regularly).
