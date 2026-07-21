const http = require("http");
const escpos = require("escpos");

escpos.Network = require("escpos-network");

// To be changed after deploying node server
const CLOUD_POLL_URL = "http://localhost:3001/poll";
const PRINTER_IP = "10.0.0.88";

// HELPER FUNCTIONS
function formatTime12Hour(time24) {
  const [hour, minute] = time24.split(":").map(Number);

  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;

  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

async function printOrder(order) {
  const device = new escpos.Network(PRINTER_IP);
  console.log("Printing order:\n", order);
  console.log(order.items);

  device.open((err) => {
    if (err) {
      console.error("Printer connection error:", err);
      return;
    }

    const printer = new escpos.Printer(device);

    printer
      .align("CT")
      .style("B")
      .text("ORDER")
      .text(order.customerName || "No name given")
      .text(`Pickup: ${order.pickupDate} ${formatTime12Hour(order.pickupTime)}`)
      .drawLine()
      .align("LT");

    order.items.forEach((item) => {
      printer.style("NORMAL").text(`${item.qty}x ${item.name}`);

      if (item.note && item.note.trim() !== "") {
        printer.style("B").text(`Note: ${item.note}`).style("NORMAL");
      }

      printer.text("");
    });

    printer.drawLine().cut().close();
  });
}

function poll() {
  http
    .get(CLOUD_POLL_URL, (res) => {
      const chunks = [];

      res.on("data", (chunk) => chunks.push(chunk));

      res.on("end", () => {
        if (res.statusCode === 204) {
          return;
        }

        try {
          const body = Buffer.concat(chunks).toString("utf8");
          const order = JSON.parse(body);

          console.log("Received order:", order);

          printOrder(order);
        } catch (err) {
          console.error("Failed to process job:", err);
        }
      });
    })
    .on("error", (err) => {
      console.error("Polling error:", err);
    });
}

setInterval(() => {
  console.log("Polling for orders...");
  poll();
}, 3000);

// let testOrder = {
//   id: "o6ez0u90",
//   items: [
//     {
//       name: "Hot: Cappuccino (Whole Milk, Vanilla, Extra 1/2 oz Flavor)",
//       qty: 1,
//       milkId: "cm4rrchkk",
//       addonQuantities: {
//         cadbts0yg: 1,
//       },
//       kind: "coffee",
//       flavorIds: ["fle3dws87"],
//       itemId: "ci1fe9sup",
//       note: "I love my job",
//     },
//   ],
//   status: "incomplete",
//   customerName: "Noah Johnson",
//   weekKey: "2026-07-20",
//   pickupDate: "2026-07-21",
//   customerPhone: "8123094360",
//   submittedAt: "2026-07-21T18:26:26.038Z",
//   pickupTime: "16:26",
//   autoprinted: false,
// };
// printOrder(testOrder);

// const http = require("http"); // or http
// const net = require("net");

// const CLOUD_POLL_URL = "http://localhost:3001/poll";
// const PRINTER_IP = "10.0.0.88";

// setInterval(() => {
//   http.get(CLOUD_POLL_URL, (res) => {
//     let data = [];
//     res.on("data", (chunk) => data.push(chunk));
//     res.on("end", () => {
//       if (res.statusCode === 204) return; // no job

//       //   const job = Buffer.concat(data);

//       // Build job here

//       const client = net.createConnection(
//         { host: PRINTER_IP, port: 9100 },
//         () => {
//           client.write(job);
//           client.end();
//         }
//       );
//     });
//   });
// }, 3000); // Poll every 3 seconds
