# DataSmith

![banner.png](./banner.png)

Ever been frustrated with having only limited data to test your applications?
Wished there was a tool that could **quickly generate sample data for your database** minimal hassle?
**Me too. So I built DataSmith.**

DataSmith is a user-friendly evolution of my previous project, [DataForge](https://github.com/MZaFaRM/DataForge), designed to make database population fast and simple.

I'd love to hear any feedback or suggestions!

## Setup & Installation

### Easiest Way

Download the latest release from the [📦 Releases](https://github.com/MZaFaRM/DataSmith/releases) page.

### Developer Setup

If you’d like to build it yourself or contribute, follow the instructions below:

### Prerequisites

- Python 3.x
- Node.js (≥ 18)
- pnpm (≥ 8), or npm/yarn
- Rust (stable) + Cargo
- Tauri CLI:

  ```bash
  pnpm add -D @tauri-apps/cli
  ```

### Steps

1. **Clone the repository**

   ```bash
   git clone https://github.com/MZaFaRM/DataSmith.git
   cd DataSmith
   ```

2. **Set up Python backend**

   ```bash
   python -m venv venv
   source venv/Scripts/activate  # On Unix: source venv/bin/activate
   pip install -r requirements.txt
   python build.py
   ```

3. **Set up the frontend**

   ```bash
   pnpm install
   pnpm tauri dev
   ```

4. **Done!**

## 🚀 Usage

Boot up the application, connect to a database, and start generating and inserting test data with just a few clicks.
