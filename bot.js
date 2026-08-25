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

// 1. HOME ROUTE
app.get('/', (req, res) => {
  if (isFetching) {
    return res.send("A batch fetch is already in progress. Please check back shortly.");
  }
  res.send("Chandail Labs Power Bot is Active and Fetching!");
  runBot().catch(err => console.error("Background run error:", err));
});

// 2. VIEW ACCOUNTS ROUTE
app.get('/accounts', (req, res) => {
  let html = `<h3>Currently Tracked Accounts (${accounts.length}):</h3><ul>`;
  accounts.forEach(acc => {
    html += `<li><b>${acc.company}</b> - CA: ${acc.caNumber}</li>`;
  });
  html += `</ul><p>Add new account via: <code>/add/YOUR_CA_NUMBER/SBPDCL</code></p>`;
  html += `<p>Delete account via: <code>/delete/YOUR_CA_NUMBER</code></p>`;
  res.send(html);
});

// 3. ADD ACCOUNT ROUTE
app.get('/add/:ca/:company', (req, res) => {
  const caNumber = req.params.ca.replace(/[<>]/g, '').trim();
  const company = (req.params.company || "SBPDCL").replace(/[<>]/g, '').trim().toUpperCase();

  const exists = accounts.some(acc => acc.caNumber === caNumber);
  if (exists) {
    return res.send(`<h3>CA Number ${caNumber} already exists!</h3><a href="/accounts">View all accounts</a>`);
  }

  accounts.push({ caNumber, company });
  res.send(`<h3>Successfully added CA: ${caNumber} (${company})!</h3><a href="/accounts">View all accounts</a>`);
});

// 4. DELETE ACCOUNT ROUTE
app.get('/delete/:ca', (req, res) => {
  const target = req.params.ca.replace(/[<>]/g, '').trim();
  const prevCount = accounts.length;
  accounts = accounts.filter(acc => acc.caNumber.replace(/[<>]/g, '').trim() !== target);

  if (accounts.length < prevCount) {
    res.send(`<h3>Successfully deleted CA: ${target}!</h3><a href="/accounts">View all accounts</a>`);
  } else {
    res.send(`<h3>CA Number ${target} was not found!</h3><a href="/accounts">View all accounts</a>`);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// --- SCRAPING ENGINE ---
async function runBot() {
  if (isFetching) return;
  isFetching = true;
  console.log("Starting automated batch fetch...");

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
        
        // CRITICAL FIX: Open a completely fresh tab for every single CA number
        page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        const url = acc.company === "NBPDCL" 
          ? "https://wss.nbpdcl.co.in/cportal/#/guest/secure/searchbill" 
          : "https://wss.sbpdcl.co.in/cportal/#/guest/secure/searchbill";

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 35000 });
        await page.waitForSelector('input', { timeout: 15000 });

        const inputs = await page.$$('input');
        for (let input of inputs) {
          const type = await page.evaluate(el => el.getAttribute('type'), input);
          if (!type || type === 'text' || type === 'number' || type === 'tel') {
            // Triple click to select old text, hit backspace, then type fresh number
            await input.click({ clickCount: 3 });
            await page.keyboard.press('Backspace');
            await input.type(acc.caNumber, { delay: 100 });
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
          console.log(`Result for ${acc.caNumber}: ${balanceValue}`);
        } else {
          console.log(`Result for ${acc.caNumber}: Error: Not Found`);
          await sendToSheet(acc.caNumber, "Error: Not Found", acc.company);
        }

      } catch (err) {
        console.error(`Error on CA ${acc.caNumber}:`, err.message);
        await sendToSheet(acc.caNumber, "Error: " + err.message, acc.company);
      } finally {
        // CRITICAL FIX: Close the tab immediately after it finishes so the next one is clean
        if (page) await page.close();
      }
      // Wait 3 seconds before starting the next tab to avoid spamming the website
      await new Promise(r => setTimeout(r, 3000));
    }

    console.log("Batch fetch completed successfully!");
  } catch (e) {
    console.error("Puppeteer batch crashed:", e);
  } finally {
    if (browser) await browser.close();
    isFetching = false;
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
