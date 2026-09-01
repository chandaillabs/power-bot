const express = require('express');
const puppeteer = require('puppeteer');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

let isFetching = false;

// Active accounts list
let accounts = [
  { caNumber: "101353117", company: "SBPDCL" },
  { caNumber: "101329031", company: "SBPDCL" },
  { caNumber: "101342329", company: "SBPDCL" },
  { caNumber: "1071075111", company: "NBPDCL" },
  { caNumber: "1071075108", company: "NBPDCL" }
];

const API_URL = "https://script.google.com/macros/s/AKfycbzPaL5u1FJeSHCYdvzOsf3z6rUgzbhtSn_-2iyU1DcIkmMsPzpZOewskpI8z-amjNGM/exec";

// 1. HOME / CRON TRIGGER ROUTE
app.get('/', (req, res) => {
  if (isFetching) {
    return res.status(200).send("A batch fetch is already in progress.");
  }
  // Respond immediately so external pings (cron/Google Apps Script) never timeout
  res.status(200).send("Chandail Labs Bot Awake! Batch scrape triggered in background.");
  runBatchScrape().catch(err => console.error("Scrape error:", err));
});

// 2. VIEW ACCOUNTS ROUTE
app.get('/accounts', (req, res) => {
  let html = `<h3>Currently Tracked Accounts (${accounts.length}):</h3><ul>`;
  accounts.forEach((acc) => {
    html += `<li><b>${acc.company}</b> - CA: ${acc.caNumber}</li>`;
  });
  html += `</ul><p>Add: <code>/add/YOUR_CA_NUMBER/SBPDCL</code></p>`;
  html += `<p>Delete: <code>/delete/YOUR_CA_NUMBER</code></p>`;
  res.send(html);
});

// 3. ADD ACCOUNT ROUTE
app.get('/add/:ca/:company', (req, res) => {
  const caNumber = req.params.ca.replace(/[<>]/g, '').trim();
  const company = (req.params.company || "SBPDCL").replace(/[<>]/g, '').trim().toUpperCase();

  if (accounts.some(acc => acc.caNumber === caNumber)) {
    return res.send(`<h3>CA Number ${caNumber} already exists!</h3><a href="/accounts">View accounts</a>`);
  }

  accounts.push({ caNumber, company });
  res.send(`<h3>Added CA: ${caNumber} (${company})!</h3><a href="/accounts">View accounts</a>`);
});

// 4. DELETE ACCOUNT ROUTE
app.get('/delete/:ca', (req, res) => {
  const target = req.params.ca.replace(/[<>]/g, '').trim();
  const prevCount = accounts.length;
  accounts = accounts.filter(acc => acc.caNumber.replace(/[<>]/g, '').trim() !== target);

  if (accounts.length < prevCount) {
    res.send(`<h3>Deleted CA: ${target}!</h3><a href="/accounts">View accounts</a>`);
  } else {
    res.send(`<h3>CA Number ${target} not found!</h3><a href="/accounts">View accounts</a>`);
  }
});

// Start Express Server
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  // AUTO-RUN ON STARTUP/WAKE:
  setTimeout(() => {
    console.log("Startup detected: Running initial balance scrape...");
    runBatchScrape().catch(err => console.error("Initial run error:", err));
  }, 3000);
});

// --- SEQUENTIAL SCRAPER (All 5 Accounts) ---
async function runBatchScrape() {
  if (isFetching || accounts.length === 0) return;
  isFetching = true;
  console.log(`[${new Date().toLocaleTimeString()}] Starting scrape for ${accounts.length} accounts...`);

  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      timeout: 60000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-extensions'
      ]
    });

    for (let acc of accounts) {
      let page = null;
      try {
        console.log(`Processing ${acc.company} CA: ${acc.caNumber}`);
        page = await browser.newPage();
        page.setDefaultNavigationTimeout(35000);
        page.setDefaultTimeout(35000);

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        const url = acc.company === "NBPDCL" 
          ? "https://wss.nbpdcl.co.in/cportal/#/guest/secure/searchbill" 
          : "https://wss.sbpdcl.co.in/cportal/#/guest/secure/searchbill";

        await page.goto(url, { waitUntil: 'networkidle2' });
        await page.waitForSelector('input');

        const inputs = await page.$$('input');
        for (let input of inputs) {
          const type = await page.evaluate(el => el.getAttribute('type'), input);
          if (!type || type === 'text' || type === 'number' || type === 'tel') {
            await input.click({ clickCount: 3 });
            await page.keyboard.press('Backspace');
            await input.type(acc.caNumber, { delay: 80 });
            break;
          }
        }

        await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"]'));
          const btn = buttons.find(b => (b.innerText || b.value || "").toLowerCase().includes('search'));
          if (btn) btn.click();
        });

        await new Promise(r => setTimeout(r, 4500));

        await page.evaluate(() => {
          const els = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], span'));
          const btn = els.find(el => (el.innerText || el.value || "").includes('Get Current Balance'));
          if (btn) btn.click();
        });

        await new Promise(r => setTimeout(r, 4500));

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

        if (balanceValue) {
          await sendToSheet(acc.caNumber, balanceValue, acc.company);
          console.log(`Success -> ${acc.caNumber}: ₹${balanceValue}`);
        } else {
          console.log(`Failed -> ${acc.caNumber}: Not Found`);
          await sendToSheet(acc.caNumber, "Error: Not Found", acc.company);
        }

      } catch (err) {
        console.error(`Error on CA ${acc.caNumber}:`, err.message);
        await sendToSheet(acc.caNumber, "Error: " + err.message, acc.company);
      } finally {
        if (page && !page.isClosed()) await page.close();
      }

      await new Promise(r => setTimeout(r, 2000));
    }

    console.log("Batch run complete! All accounts updated.");
  } catch (e) {
    console.error("Batch crashed:", e);
  } finally {
    if (browser) await browser.close();
    isFetching = false;
  }
}

async function sendToSheet(caNumber, balance, company) {
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ caNumber, availableBalance: balance, company })
    });
    await res.text();
  } catch (e) {
    console.error("Google Sheet send error:", e);
  }
}
