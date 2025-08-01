![banner.png](./banner.png)

<p align="center">
  <img src="https://img.shields.io/badge/mysql-4479A1.svg?style=for-the-badge&logo=mysql&logoColor=white"/>
  <img src="https://img.shields.io/badge/postgres-%23316192.svg?style=for-the-badge&logo=postgresql&logoColor=white"/>
  <img src="https://img.shields.io/badge/MariaDB-003545?style=for-the-badge&logo=mariadb&logoColor=white"/>
  <img src="https://img.shields.io/badge/Microsoft%20SQL%20Server-CC2927?style=for-the-badge&logo=microsoft%20sql%20server&logoColor=white"/>
  <img src="https://img.shields.io/badge/firebase-a08021?style=for-the-badge&logo=firebase&logoColor=ffcd34"/>
</p>

<div align="center">
  <img src="./app-icon.png" width="100px" />
  <h1>DataSmith</h1>
</div>

![BuyMeACoffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)

Ever been frustrated with having only limited data to test your applications?
Wished there was a tool that could **quickly generate sample data for your database** minimal hassle?
**Me too. So I built DataSmith.**

DataSmith is a user-friendly evolution of my previous project, [DataForge](https://github.com/MZaFaRM/DataForge), designed to make database population fast and simple.

I'd love to hear any feedback or suggestions!

## Features

- Populate your databases easily with extremely customizable sample data
- Supports `MYSQL`, `POSTGRESQL`, `MSSQL`, `ORACLE`, `MARIADB`, `FIREBIRD`
- Insert data into your database or export its sql query based on custom specifications
- Specify data generation by CONSTANT, NULL, LIBRARY, REGEX, PYTHON and more...

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

Boot up the application, connect to a database, and easily start generating and inserting custom data.

![banner](https://github.com/user-attachments/assets/c3a20074-a519-4b2e-8119-8f6ad1bf4968)

---


<div align="right">
  Drop a ⭐  if you liked this project. 
</div>
