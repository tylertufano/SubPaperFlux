# Instapaper Credential Onboarding

The web console now walks administrators through exchanging Instapaper login credentials for long-lived API tokens. Use this flow instead of manually copying OAuth tokens into the database.

1. Sign in to the web UI and open **Credentials**.
2. Enter a descriptive label (for example, `Main Instapaper Account`) and choose **instapaper** from the Kind menu. The description is required and appears in lists/search to make it obvious which Instapaper account the tokens map to.
3. Supply the Instapaper username or email address and password that should be authorized. Leave the scope checkbox unchecked to create a per-user credential, or mark it as **Global (admin)** to share the tokens with all operators.
4. Submit the form. The UI calls `/credentials/instapaper/login`, which performs the OAuth exchange and stores the resulting access tokens alongside the provided description.
5. After the success banner appears, refresh jobs or services that depend on Instapaper tokens so they load the new credential ID.

If the login fails, the page surfaces the returned error so you can correct the username, password, or Instapaper multi-factor prompt before retrying.

## API request shape

Developers can invoke the onboarding endpoint directly for smoke tests or scripted setups. The UI sends a POST request to `/credentials/instapaper/login` with a JSON body containing:

```json
{
  "description": "Main Instapaper Account",
  "username": "user@example.com",
  "password": "<instapaper password>",
  "scope_global": true
}
```

Set `scope_global` to `false` (or omit it) to keep the credential scoped to the current user. Successful responses persist the encrypted tokens and return the masked credential record; failures include a 400 for bad credentials or a 502 when the Instapaper API rejects the request for another reason.
