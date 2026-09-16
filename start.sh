#!/bin/bash
# Start both the Flask server and Telegram bot

echo "🔧 Starting OILLOG..."

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Install dependencies
echo "📥 Installing dependencies..."
pip install -q -r requirements.txt

# Create data directory
mkdir -p data

# Start Flask server in background
echo "🌐 Starting Flask server on port ${PORT:-8080}..."
python server.py &
FLASK_PID=$!

# Start Telegram bot in background
echo "🤖 Starting Telegram bot..."
python bot.py &
BOT_PID=$!

# Handle shutdown
trap "echo '🛑 Stopping services...'; kill $FLASK_PID $BOT_PID 2>/dev/null; exit 0" INT TERM

# Wait for both processes
wait