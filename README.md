# Goose Pretzels

## Shared storage setup (free Supabase plan)
The site uses Supabase for a shared menu, EmailJS configuration, and order list. Supabase's free plan currently includes a small database and Auth, but free projects can pause after one week without activity. A paused project must be resumed before the site can read or write shared data.

1. Create a free project at [Supabase](https://supabase.com/dashboard).
2. Open the project's SQL Editor, paste the contents of `supabase/schema.sql`, and run it. The script creates the shared tables and row-level security policies.
3. In Authentication settings, disable public sign-ups. Then create the owner/admin user from the project's Users page. Only this account should be able to change the catalog and EmailJS settings or read/delete orders.
4. In your Supabase project, click **Connect** near the top of the dashboard. Copy the **Project URL** and **Publishable key** into `supabase-config.js`, replacing the empty `url` and `publishableKey` values. These browser values are public; never put a `secret` or `service_role` key in this file. This edits your local copy only; it does not change the live website yet.
5. Open the admin page on the same browser that has the existing local catalog/orders, then sign in with the Supabase admin account. On the first sign-in, existing local catalog, EmailJS settings, and orders are copied to Supabase if they are not already there.
6. Use EmailJS Settings in the admin page to save the Service ID, Template ID, and Public Key. This is now shared with all visitors.
7. In VS Code Source Control, commit the changed files and choose **Sync Changes** or **Push**. Wait for GitHub Pages to finish deploying in the repository's **Actions** tab. Only then will the live site use the updated code and Supabase config. Local development and the live site will use the same project after deployment.

The database is protected with row-level security. Anyone can read the menu and EmailJS's public configuration and submit an order. Only signed-in users can manage the catalog/settings or read and delete orders. Keep public sign-ups disabled so only the admin account can access those operations.

## Publish code changes
To publish code changes to GitHub Pages from VS Code:

1. Open **Source Control** from the left sidebar.
2. Review the changed files, enter a short commit message, and choose **Commit**.
3. Choose **Sync Changes** or **Push** to send the commit to GitHub.
4. GitHub Pages deploys from the configured repository branch. Check **Actions** in the GitHub repository for the Pages deployment to finish, then reload the live site.

To preview locally first, run `python3 -m http.server 8000` from the project folder and open `http://localhost:8000`.

## Free email integration
Order emails are sent with EmailJS. Its SDK is loaded from a CDN on the checkout page. Configure the EmailJS template to send to `finn121212@icloud.com` and use these template variables: `customer_name`, `customer_email`, `phone`, `order_id`, `order_total`, `order_expires`, `order_details`, `notes`, and `payment`. EmailJS's free plan has sending limits; check its pricing page for current limits.

## How to change pricing or add menu items
Current default pricing is $5 for a Small bag and $8 for a Large bag for both Original and Crabby.

1. Open the admin page at /admin.html.
2. Sign in with the Supabase admin email and password created during setup.
3. Use the Catalog Manager section to:
   - change the Small bag or Large bag price independently
   - update the name or description
   - click Add product to create a listing, then add any number of named sizes and prices
   - remove a listing that is no longer sold
4. Click Save after each change.
5. The menu displays both bag sizes, and checkout totals automatically update for all visitors using Supabase.

## Notes
- Before Supabase is configured, the site can use browser-local demo data. Once connected, products, EmailJS settings, and orders are stored centrally and shared across devices.
- The shopping cart and theme choice remain in each visitor's browser.
- Admin access uses the Supabase account created for the owner; the old client-side password gate is no longer used.
- For a new product, use a clear name and a short description so the order emails remain easy to read.
- Keep pricing aligned with the order totals shown in the checkout and admin summaries.