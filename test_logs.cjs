const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));
    
    await page.goto('http://localhost:5174');
    await page.waitForTimeout(2000);
    
    // Check if the canvas exists
    const canvas = await page.$('canvas');
    console.log('Canvas exists:', !!canvas);
    
    await browser.close();
})();
