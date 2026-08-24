const express = require('express');
const puppeteer = require('puppeteer');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// List of accounts
let accounts = [
  { caNumber: "101353117", company: "SBPDCL" },
  { caNumber: "101329031", company: "SBPDCL" }
];

const API_URL = "https://script.google.com/macros/s/AKfycbzPaL5u1FJeSHCYdvzOsf3z6rUgzbhtSn_-2iyU1DcIkmMsPzpZOewskpI8z-amjNGM/exec";

// HOME ROUTE: Shows active accounts and triggers fetch
app.get('/', async (req, res) => {
  let html = `<h2>Chandail Labs Power Bot is Active!</h2>`;
  html += `<h3>Currently Added Accounts (${accounts.length}):</h3><ul>`;
  accounts.forEach(acc => {
    html += `<li><b>${acc.company}</b> - CA Number: ${acc.caNumber}</li>`;
  });
  html += `</ul><p>To add a new CA, go to: <code>/add/CA_NUMBER/COMPANY</code> (e.g. /add/101353117/SBPDCL)</p>`;
  
  console.log("Ping received! Running batch fetch for all CA numbers...");
  await runBot();
  
  res.send(html + `<p><i>Automatic fetch executed successfully on ping!</i></p>`);
});

// ADD ACCOUNT ROUTE: Clean URL structure like /add/101353117/SBPDCL
app.get('/add/:ca/:company', (req, res) => {
  const caNumber = req.params.ca;
  const company = (req.params.company || "SBPDCL").toUpperCase();

  const exists = accounts.some(acc => acc.caNumber === caNumber);
  if (exists) {
    return res.send(`<h3>CA Number ${caNumber} is already in the list!</h3><a href="/">View all accounts</a>`);
  }

  accounts.push({ caNumber, company });
  res.send(`<h3>Successfully added CA Number: ${caNumber} (${company})!</h3><a href="/">View all accounts</a>`);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// --- AUTOMATION SCRAPING LOGIC ---
async function runBot() {
  try {
    const browser = await puppeteer.launch({
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox']
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
  } catch (e) {
    console.error("Puppeteer crashed:", e);
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
