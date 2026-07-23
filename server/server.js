const express = require("express");
const cors = require("cors");
const escpos = require("escpos");
escpos.Network = require("escpos-network");

const app = express();

// Maybe eventually restrict CORS to only the iPad but this is fine
app.use(
  cors({
    origin: true,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(express.json({ limit: "1mb" }));

const orderQueue = [];
const PRINTER_IP = "10.0.0.88";

app.get("/", (req, res) => {
  res.send("hi");
});

// Add a new order to the queue
app.post("/print", (req, res) => {
  orderQueue.push(req.body);
  res.sendStatus(204);

  /**
   * Maybe make printing async:
   * - push job to queue
   * - try to print
   * - if print is successful, return 204
   * - if not, signal error somehow (don't remember the status I would need)
   * - if print did not succeed (paper empty, etc), order autoprinted stays false
   * - try again?
   */
});

// HELPER FUNCTIONS
function formatTime12Hour(time24) {
  const [hour, minute] = time24.split(":").map(Number);

  const suffix = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;

  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

/**
 *
 * @param {order} - JSON object with order information
 * Open a connection to the printer at PRINTER_IP
 * Print a formatted receipt for the given order
 */
async function printOrder(order) {
  try {
    const device = new escpos.Network(PRINTER_IP, 9100);

    device.open((err) => {
      if (err) {
        console.error("Printer connection error:", err);
        return;
      }

      const printer = new escpos.Printer(device, {
        width: 42,
      });

      console.log("Printing order:\n", order);

      printer
        .align("CT")
        .style("B")
        .text("ORDER")
        .text(order.customerName || "No name given")
        .text(order.customerPhone || "No phone number given")
        .text(
          `Pickup: ${order.pickupDate} ${formatTime12Hour(order.pickupTime)}`
        )
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
  } catch (err) {
    console.error("Print error: ", err);
  }
}

/**
 * Poll the print job queue every 3 seconds.
 * While there are jobs in the queue:
 * - get print job
 * - connect to printer
 * - send print job
 * - log errors
 * - close connection
 */
setInterval(() => {
  if (orderQueue.length > 0)
    console.log(
      `Received ${orderQueue.length} order${orderQueue.length > 1 ? "s" : ""}`
    );

  while (orderQueue.length > 0) {
    const order = orderQueue.shift();
    printOrder(order);
    if (orderQueue.length === 0) console.log("Waiting for orders...");
  }
}, 3000);

// Start listening on port 3069
app.listen(3069, () => {
  console.log(
    "Local order printing server running on port 3069\nWaiting for orders..."
  );
});
