const express = require('express');
const puppeteer = require('puppeteer');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// List of your active electricity accounts
let accounts = [
  { caNumber: "101353117", company: "SBPDCL" },
  { caNumber: "101329031", company: "SBPDCL" }
];

const API_URL = "https://script.google.com/macros/s/AKfycbzPaL5u1FJeSHCYdvzOsf3z6rUgzbhtSn_-2iyU1DcIkmMsPzpZOewskpI8z-amjNGM/exec";

// 1. HOME ROUTE: Instantly responds to Render & UptimeRobot/Cron-Job pings, and triggers background fetch
app.get('/', (req, res) => {
  res.send("Chandail Labs Power Bot is Active and Fetching!");
  runBot().catch(err => console.error("Background run error:", err));
});

// 2. VIEW ACCOUNTS ROUTE: See what is currently tracked
app.get('/accounts', (req, res) => {
  let html = `<h3>Currently Tracked Accounts (${accounts.length}):</h3><ul>`;
  accounts.forEach(acc => {
    html += `<li><b>${acc.company}</b> - CA: ${acc.caNumber}</li>`;
  });
  html += `</ul><p>Add new account via URL: <code>/add/YOUR_CA_NUMBER/SBPDCL</code></p>`;
  res.send(html);
});

// 3. ADD ACCOUNT ROUTE: Dynamically add new CA numbers without editing code
app.get('/add/:ca/:company', (req, res) => {
  const caNumber = req.params.ca;
  const company = (req.params.company || "SBPDCL").toUpperCase();

  const exists = accounts.some(acc => acc.caNumber === caNumber);
  if (exists) {
    return res.send(`<h3>CA Number ${caNumber} already exists!</h3><a href="/accounts">View all accounts</a>`);
  }

  accounts.push({ caNumber, company });
  res.send(`<h3>Successfully added CA: ${caNumber} (${company})!</h3><a href="/accounts">View all accounts</a>`);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// --- AUTOMATION SCRAPING LOGIC ---
async function runBot() {
  console.log("Starting automated batch fetch...");
  try {
    // Launches Puppeteer using its standard cache-installed browser path automatically
    const browser = await puppeteer.launch({
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();

    for (let acc of accounts) {
      try {
        const url = acc.company === "NBPDCL" 
          ? "https://wss.nbpdcl.co.in/cportal/#/guest/secure/searchbill" 
          : "https://wss.sbpdcl.co.in/cportal/#/guest/secure/searchbill";

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        await page.waitForSelector('input', { timeout: 15000 });

        const inputs = await page.$$('input');
        for (let input of inputs) {
          const type = await page.evaluate(el => el.getAttribute('type'), input);
          if (!type || type === 'text' || type === 'number' || type === 'tel') {
            await input.click();
            await input.type(acc.caNumber, { delay: 100 });
            break;
          }
        }

        await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"]'));
          const btn = buttons.find(b => (b.innerText || b.value || "").toLowerCase().includes('search'));
          if (btn) btn.click();
        });

        await new Promise(r => setTimeout(r, 4000));

        await page.evaluate(() => {
          const els = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], span'));
          const btn = els.find(el => (el.innerText || el.value || "").includes('Get Current Balance'));
          if (btn) btn.click();
        });

        await new Promise(r => setTimeout(r, 4000));

        const balanceValue = await page.evaluate(() => {
          const all = Array.from(document.querySelectorAll('*'));
          const label = all.reverse().find(el => el.children.length === 0 && el.innerText && el.innerText.toLowerCase().includes('available balance'));
          if (!label) return null;
          let cell = label.closest('td, th, div') || label;
          let valCell = cell.nextElementSibling || cell.parentElement?.nextElementSibling;
          let text = valCell ? valCell.innerText : cell.parentElement.innerText;
          let match = text.match(/-?\s*₹?\s*(-?\d[\d,]*\.?\d*)/);
          return match ? match[0].replace(/[^0-9.-]/g, '') : null;
        });

        await sendToSheet(acc.caNumber, balanceValue || "Error: Not Found", acc.company);
      } catch (err) {
        await sendToSheet(acc.caNumber, "Error: " + err.message, acc.company);
      }
      await new Promise(r => setTimeout(r, 3000));
    }
    await browser.close();
    console.log("Batch fetch completed successfully!");
  } catch (e) {
    console.error("Puppeteer crashed during batch run:", e);
  }
}

async function sendToSheet(caNumber, balance, company) {
  try {
    await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ caNumber, availableBalance: balance, company })
    });
  } catch (e) {
    console.error("Sheet sync error:", e);
  }
}
