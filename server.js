import express from "express"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const app = express()
const PORT = process.env.PORT || 3000

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Middleware
app.use(express.json())
app.use(express.static("public"))

// Ensure data directory and file exist
const dataDir = path.join(__dirname, "data")
const dataFile = path.join(dataDir, "data.json")

function ensureDataFileExists() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  if (!fs.existsSync(dataFile)) {
    const initialData = {
      profile: {
        name: "Alfie Luxiona Lexandra",
        balance: 0,
      },
      transactions: [],
    }
    fs.writeFileSync(dataFile, JSON.stringify(initialData, null, 2), "utf8")
  }
}

ensureDataFileExists()

// Helper function to read data
function readData() {
  try {
    const data = fs.readFileSync(dataFile, "utf8")
    return JSON.parse(data)
  } catch (error) {
    console.error("Error reading data file:", error)
    return null
  }
}

// Helper function to write data
function writeData(data) {
  try {
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), "utf8")
    return true
  } catch (error) {
    console.error("Error writing to data file:", error)
    return false
  }
}

// Add this function after the writeData function

// Function to check if it's a new month and generate reports
function checkForNewMonth() {
  const now = new Date()
  const currentDate = now.getDate()
  const currentMonth = now.getMonth()
  const currentYear = now.getFullYear()

  // Check if it's the first day of the month
  if (currentDate === 1) {
    console.log("First day of the month detected. Checking for data refresh...")

    // Read the last refresh date from a file
    const lastRefreshFile = path.join(__dirname, "data", "last_refresh.json")
    let lastRefresh = { month: -1, year: -1 }

    try {
      if (fs.existsSync(lastRefreshFile)) {
        lastRefresh = JSON.parse(fs.readFileSync(lastRefreshFile, "utf8"))
      }
    } catch (error) {
      console.error("Error reading last refresh file:", error)
    }

    // If it's a new month compared to the last refresh
    if (currentMonth !== lastRefresh.month || currentYear !== lastRefresh.year) {
      console.log("New month detected. Archiving previous month data...")

      // Archive previous month's data
      const data = readData()
      if (data) {
        // Calculate previous month
        let prevMonth = currentMonth - 1
        let prevYear = currentYear
        if (prevMonth < 0) {
          prevMonth = 11 // December
          prevYear -= 1
        }

        const prevMonthStr = prevMonth + 1 < 10 ? `0${prevMonth + 1}` : `${prevMonth + 1}`
        const prevMonthPrefix = `${prevYear}-${prevMonthStr}`

        // Filter transactions for the previous month
        const prevMonthTransactions = data.transactions.filter((t) => t.date.startsWith(prevMonthPrefix))

        if (prevMonthTransactions.length > 0) {
          // Create archive directory if it doesn't exist
          const archiveDir = path.join(__dirname, "data", "archive")
          if (!fs.existsSync(archiveDir)) {
            fs.mkdirSync(archiveDir, { recursive: true })
          }

          // Save previous month's data to archive
          const archiveFile = path.join(archiveDir, `${prevYear}_${prevMonthStr}.json`)
          fs.writeFileSync(
            archiveFile,
            JSON.stringify(
              {
                month: prevMonth + 1,
                year: prevYear,
                transactions: prevMonthTransactions,
              },
              null,
              2,
            ),
            "utf8",
          )

          console.log(`Archived ${prevMonthTransactions.length} transactions for ${prevYear}-${prevMonthStr}`)
        }
      }

      // Update last refresh date
      fs.writeFileSync(
        lastRefreshFile,
        JSON.stringify(
          {
            month: currentMonth,
            year: currentYear,
            date: now.toISOString(),
          },
          null,
          2,
        ),
        "utf8",
      )
    }
  }
}

// API Routes
app.get("/api/profile", (req, res) => {
  const data = readData()
  if (data) {
    res.json(data.profile)
  } else {
    res.status(500).json({ error: "Failed to read profile data" })
  }
})

app.get("/api/transactions", (req, res) => {
  const data = readData()
  if (data) {
    res.json(data.transactions)
  } else {
    res.status(500).json({ error: "Failed to read transactions data" })
  }
})

app.post("/api/transactions", (req, res) => {
  const { type, amount, category, description, date } = req.body

  if (!type || !amount || !category || !date) {
    return res.status(400).json({ error: "Missing required fields" })
  }

  const data = readData()
  if (!data) {
    return res.status(500).json({ error: "Failed to read data file" })
  }

  const newTransaction = {
    id: Date.now().toString(),
    type,
    amount: Number.parseFloat(amount),
    category,
    description: description || "",
    date,
  }

  // Update balance
  if (type === "income") {
    data.profile.balance += Number.parseFloat(amount)
  } else if (type === "expense") {
    data.profile.balance -= Number.parseFloat(amount)
  }

  data.transactions.push(newTransaction)

  if (writeData(data)) {
    res.status(201).json(newTransaction)
  } else {
    res.status(500).json({ error: "Failed to save transaction" })
  }
})

app.get("/api/statistics/daily", (req, res) => {
  const data = readData()
  if (!data) {
    return res.status(500).json({ error: "Failed to read data file" })
  }

  const today = new Date().toISOString().split("T")[0]
  const todayExpenses = data.transactions
    .filter((t) => t.type === "expense" && t.date.startsWith(today))
    .reduce((sum, t) => sum + t.amount, 0)

  res.json({ date: today, totalExpense: todayExpenses })
})

app.get("/api/statistics/weekly", (req, res) => {
  const data = readData()
  if (!data) {
    return res.status(500).json({ error: "Failed to read data file" })
  }

  const now = new Date()
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]

  const weeklyTransactions = data.transactions.filter((t) => t.date >= oneWeekAgo)
  const weeklyIncome = weeklyTransactions.filter((t) => t.type === "income").reduce((sum, t) => sum + t.amount, 0)
  const weeklyExpense = weeklyTransactions.filter((t) => t.type === "expense").reduce((sum, t) => sum + t.amount, 0)

  res.json({
    startDate: oneWeekAgo,
    endDate: now.toISOString().split("T")[0],
    income: weeklyIncome,
    expense: weeklyExpense,
    net: weeklyIncome - weeklyExpense,
  })
})

app.get("/api/statistics/monthly", (req, res) => {
  const data = readData()
  if (!data) {
    return res.status(500).json({ error: "Failed to read data file" })
  }

  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const monthStr = month < 10 ? `0${month}` : `${month}`
  const monthPrefix = `${year}-${monthStr}`

  const monthlyTransactions = data.transactions.filter((t) => t.date.startsWith(monthPrefix))
  const monthlyIncome = monthlyTransactions.filter((t) => t.type === "income").reduce((sum, t) => sum + t.amount, 0)
  const monthlyExpense = monthlyTransactions.filter((t) => t.type === "expense").reduce((sum, t) => sum + t.amount, 0)

  res.json({
    year,
    month,
    income: monthlyIncome,
    expense: monthlyExpense,
    net: monthlyIncome - monthlyExpense,
  })
})

app.get("/api/statistics/yearly", (req, res) => {
  const data = readData()
  if (!data) {
    return res.status(500).json({ error: "Failed to read data file" })
  }

  const now = new Date()
  const year = now.getFullYear()
  const yearPrefix = `${year}-`

  const yearlyTransactions = data.transactions.filter((t) => t.date.startsWith(yearPrefix))
  const yearlyIncome = yearlyTransactions.filter((t) => t.type === "income").reduce((sum, t) => sum + t.amount, 0)
  const yearlyExpense = yearlyTransactions.filter((t) => t.type === "expense").reduce((sum, t) => sum + t.amount, 0)

  res.json({
    year,
    income: yearlyIncome,
    expense: yearlyExpense,
    net: yearlyIncome - yearlyExpense,
  })
})

app.get("/api/statistics/chart", (req, res) => {
  const data = readData()
  if (!data) {
    return res.status(500).json({ error: "Failed to read data file" })
  }

  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const monthStr = month < 10 ? `0${month}` : `${month}`
  const monthPrefix = `${year}-${monthStr}`

  // Get all days in current month
  const daysInMonth = new Date(year, month, 0).getDate()
  const dailyData = []

  for (let day = 1; day <= daysInMonth; day++) {
    const dayStr = day < 10 ? `0${day}` : `${day}`
    const dateStr = `${monthPrefix}-${dayStr}`

    const dayTransactions = data.transactions.filter((t) => t.date === dateStr)
    const income = dayTransactions.filter((t) => t.type === "income").reduce((sum, t) => sum + t.amount, 0)
    const expense = dayTransactions.filter((t) => t.type === "expense").reduce((sum, t) => sum + t.amount, 0)

    dailyData.push({
      date: dateStr,
      day,
      income,
      expense,
      net: income - expense,
    })
  }

  res.json(dailyData)
})

// Serve the HTML pages
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"))
})

app.get("/profile", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "profile.html"))
})

app.get("/income", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "income.html"))
})

app.get("/expense", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "expense.html"))
})

app.get("/weekly", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "weekly.html"))
})

app.get("/monthly", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "monthly.html"))
})

app.get("/yearly", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "yearly.html"))
})

// Add this line right before the app.listen() call
// Check for new month when server starts
checkForNewMonth()

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Server Link : http://localhost:${PORT}`)
})
