# Google sign-in setup (about 10 minutes)

You need a free Google Cloud project and one **OAuth Client ID**. The app uses the "Sign in with Google" button (Google Identity Services). It needs only the **Client ID**. There is no client secret and no redirect URL to configure.

## 1. Create a project
1. Go to <https://console.cloud.google.com/> and sign in with the Google account that will own this.
2. Top bar project picker → **New project** → name it `Ollie CISA Coach` → **Create**. Make sure it is selected.

## 2. Configure the consent screen (the screen people see when signing in)
1. Menu → **APIs & Services → OAuth consent screen** (newer console: **Google Auth Platform → Branding**).
2. User type: **External** → **Create / Get started**.
3. App name: `Ollie CISA Coach` (or your site name). User support email: yours. Developer contact email: yours.
4. **App domain:** home page `https://your-domain`, privacy policy `https://your-domain/privacy.html`, terms `https://your-domain/terms.html`. Add `your-domain.com` under **Authorized domains**.
5. **Scopes:** keep the defaults only (`openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`). Do not add anything else. Sign-in with these basic scopes does not require Google's verification review.
6. **Publish the app:** on the consent screen page click **Publish app / Make external → In production**. If you leave it in "Testing", only the test users you list (max 100) can sign in.

## 3. Create the Client ID
1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**. Name: `Ollie web`.
3. **Authorized JavaScript origins** → **Add URI** for each address that will serve the site:
   - `https://your-domain.com` (exactly as people type it; no path, no trailing slash)
   - `https://www.your-domain.com` if you also use `www`
   - `http://localhost:3000` if you want to try it on your own computer
4. Leave **Authorized redirect URIs** empty.
5. **Create**. Copy the **Client ID** (it ends in `.apps.googleusercontent.com`).
6. Paste it into `.env` as `GOOGLE_CLIENT_ID=...` and restart the app.

Changes to origins can take from a few minutes up to a few hours to apply.

## 4. Test
Open your site → **Sign in** → **Continue with Google**. If Google shows `origin_mismatch`, the address in the browser is not in the list from step 3.3.

## Good to know
- Everyone with a Google account can sign in unless you set `ALLOWED_EMAIL_DOMAINS` in `.env` (e.g. `yourcompany.com` for a private study group).
- The app receives: Google account ID, email, name and profile photo URL. Only the nickname people type is shown on the leaderboard.
- Keep the project owner account secure (2-step verification on). Anyone who controls it controls sign-in for your site.
- If the site gets popular, check **Credentials → your client → quotas**; sign-in has very generous limits.
