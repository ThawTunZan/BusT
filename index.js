const express = require("express");
const puppeteer = require("puppeteer");
require("dotenv").config();

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
            const estimatedArrival2 =
                data.Services[0].NextBus2.EstimatedArrival;
            const estimatedArrival3 = data.Services[0].NextBus3.EstimatedArrival
                ? data.Services[0].NextBus3.EstimatedArrival
                : -1;
            // Convert the LTA timestamp into "Minutes away"
            const arrivalTime = new Date(estimatedArrival);
            const diffMs = arrivalTime - new Date(); // Difference in milliseconds
            const diffMins = Math.round(diffMs / 60000); // Convert to minutes

            const arrivalTime2 = new Date(estimatedArrival2);
            const diffMs2 = arrivalTime2 - new Date();
            const diffMins2 = Math.round(diffMs2 / 60000);

            if (estimatedArrival3 !== -1) {
                const arrivalTime3 = new Date(estimatedArrival3);
                const diffMs3 = arrivalTime3 - new Date();
                const diffMins3 = Math.round(diffMs3 / 60000);
            } else {
                diffMins3 = -1;
            }

            busTimingText = diffMins > 0 ? `${diffMins}m` : "Arr";
            busTimingText2 = diffMins2 > 0 ? `${diffMins2}m` : "Arr";
            busTimingText3 =
                diffMins3 > 0
                    ? `${diffMins3}m`
                    : diffMins3 == 0
                      ? "Arr"
                      : "No Info";
        }

        // 4. Inject the variable directly into the HTML string
        // Notice there is NO <script> tag in this HTML anymore!
        const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            /* 1. Lock the entire page to the exact ESP32 screen size */
            html, body { 
              width: 340px; 
              height: 170px; 
              margin: 0; 
              padding: 0; 
              background-color: black; 
            }
            
            /* 2. Create a safe zone that is 90% of the screen width */
            .container {
              width: 90%; 
              margin: 0 auto; /* Centers it, leaving 5% blank space on the left and right */
              padding-top: 15px;
            }

            .bus-row { 
              display: flex; 
              justify-content: space-between; 
              font-family: 'Courier New', monospace; 
              font-size: 10px; 
              font-weight: bold;
              color: red;
            }
            
            .time { 
              color: #00ff00; 
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="bus-row">
              <span>Bus ${data.Services[0].ServiceNo}</span>
              <span class="time">${busTimingText}</span>
            </div>
            <div class="bus-row">
              <span>Bus ${data.Services[0].ServiceNo}</span>
              <span class="time">${busTimingText2}</span>
            </div>
            <div class="bus-row">
              <span>Bus ${data.Services[0].ServiceNo}</span>
              <span class="time">${busTimingText3}</span>
            </div>
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
        await page.setViewport({ width: 340, height: 170 });

        // Load the HTML string we defined above
        await page.setContent(await buildDashboardHtml(), {
            waitUntil: "networkidle0",
        });

        // Take the screenshot and save it to the RAM variable as a JPG
        latestImageBuffer = await page.screenshot({
            type: "jpeg",
            quality: 90,
            fullPage: true,
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

app.get("/health", async (req, res) => {
    res.send("Server is healthy!");
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
