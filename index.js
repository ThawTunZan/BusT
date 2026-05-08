const express = require("express");
const puppeteer = require("puppeteer");

const app = express();
const PORT = process.env.PORT || 3000;

// This variable will hold the image data in the server's RAM
let latestImageBuffer = null;

// THE HTML TEMPLATE
// You can build your layout here and include the JS to fetch the LTA API
const dashboardHTML = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { background-color: black; color: orange; font-family: 'Courier New', monospace; width: 320px; height: 170px; margin: 0; padding: 10px; overflow: hidden; }
  </style>
</head>
<body>
  <h2>Bus 190: <span id="time">Fetching...</span></h2>
  <script>
    // In the real version, you will fetch the LTA API here.
    // For now, it just grabs a random number to prove it updates.
    document.getElementById('time').innerText = Math.floor(Math.random() * 10) + " mins";
  </script>
</body>
</html>
`;

// ROUTE 1: The external Cron Job hits this to trigger a new photo
app.get("/update", async (req, res) => {
    let browser;
    try {
        console.log("Cron job triggered: Taking new screenshot...");

        // Launch Puppeteer. The "args" are strictly required for Linux cloud servers.
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
            ],
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 320, height: 170 });

        // Load the HTML string we defined above
        await page.setContent(dashboardHTML, { waitUntil: "networkidle0" });

        // Take the screenshot and save it to the RAM variable as a JPG
        latestImageBuffer = await page.screenshot({
            type: "jpeg",
            quality: 90,
        });

        await browser.close();
        res.send("Successfully updated the bus display!");
    } catch (error) {
        if (browser) await browser.close();
        console.error(error);
        res.status(500).send("Error taking screenshot");
    }
});

// ROUTE 2: The ESP32 hits this to download the image instantly
app.get("/latest.jpg", (req, res) => {
    if (!latestImageBuffer) {
        return res.status(404).send("The cron job hasn't taken a picture yet!");
    }

    // Tell the ESP32 that this is a JPG image, not text
    res.set("Content-Type", "image/jpeg");
    res.send(latestImageBuffer);
});

app.get("/health", (req, res) => {
    res.send("Server is healthy!");
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
