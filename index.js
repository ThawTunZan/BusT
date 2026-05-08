const express = require("express");
const puppeteer = require("puppeteer");

const app = express();
const PORT = process.env.PORT || 3000;
const LTA_API_URL =
    process.env.LTA_API_URL ||
    "https://datamall2.mytransport.sg/ltaodataservice/v3/BusArrival";
const LTA_ACCOUNT_KEY = process.env.LTA_API_KEY || "";

// This variable will hold the image data in the server's RAM
let latestImageBuffer = null;

// THE HTML TEMPLATE
// You can build your layout here and include the JS to fetch the LTA API
async function buildDashboardHtml() {
    try {
        if (!LTA_ACCOUNT_KEY || LTA_ACCOUNT_KEY === "") {
            throw new Error(
                "LTA API Key is missing! Please set LTA_API_KEY in your .env file.",
            );
        }
        console.log("Calling LTA API...");

        // Fetch the data from LTA (This happens on your server now!)
        const response = await fetch(`${LTA_API_URL}?BusStopCode=${`10261`}`, {
            method: "GET",
            headers: {
                AccountKey: LTA_ACCOUNT_KEY,
                accept: "application/json",
            },
        });
        const data = await response.json();

        // Log the data so you can debug it in your console!
        console.log(
            "LTA Data Received:",
            JSON.stringify(data.Services[0], null, 2),
        );

        // 3. Extract the exact timing you want
        let busTimingText = "No Data";
        if (data.Services && data.Services.length > 0) {
            const estimatedArrival = data.Services[0].NextBus.EstimatedArrival;

            // Convert the LTA timestamp into "Minutes away"
            const arrivalTime = new Date(estimatedArrival);
            const diffMs = arrivalTime - new Date(); // Difference in milliseconds
            const diffMins = Math.round(diffMs / 60000); // Convert to minutes

            busTimingText = diffMins > 0 ? `${diffMins}m` : "Arr";
        }

        // 4. Inject the variable directly into the HTML string
        // Notice there is NO <script> tag in this HTML anymore!
        const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { background-color: black; color: orange; font-family: 'Courier New', monospace; width: 320px; height: 170px; margin: 0; padding: 10px; overflow: hidden; }
            .bus-row { display: flex; justify-content: space-between; font-size: 28px; margin-bottom: 10px; font-weight: bold;}
            .time { color: #00ff00; }
          </style>
        </head>
        <body>
          <div class="bus-row">
            <span>Bus 190</span>
            <span class="time">${busTimingText}</span>
          </div>
        </body>
        </html>
        `;

        return html;
    } catch (error) {
        console.error("Error fetching bus data:", error);
        return "<html><body style='background:black;color:red;'>API ERROR</body></html>";
    }
}

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
        await page.setContent(await buildDashboardHtml(), {
            waitUntil: "networkidle0",
        });

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
