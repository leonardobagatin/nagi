<div align="center">
  <h1>Nagi</h1>
  <p>
    A self-hosted AI workspace exploring deterministic, associative memory.
  </p>
  <br />
  <img width="650" alt="Nagi screenshot" src="https://github.com/user-attachments/assets/26e7af4a-8a37-4d51-a083-dbb080ff7956" />
</div>

<br />

Nagi is an experimental, self-hosted AI workspace built around a deterministic, associative memory model.

As an alternative to probabilistic vector pipelines, Nagi mimics associative recall by separating memory into two layers:
1. **Saved Queries**: Save search queries with custom context. Nagi automatically matches session titles with saved queries to inherit their context, cross-pollinating when titles match multiple queries.
2. **@Tagging**: Explicitly tag any saved query to inject its context into the next response.  

## Quick Start
Make sure you have `Python` installed, then follow these steps:
1. Clone the repository
```bash
git clone https://github.com/leonardobagatin/nagi.git
cd nagi
cp .env.example .env
```
2. Create and activate a virtual environment (recommended)
```bash
# Windows
python -m venv venv
venv\Scripts\activate

# Linux
python3 -m venv venv
source venv/bin/activate
```
3. Install requirements.txt
```bash
pip install -r requirements.txt
```
Once that's done, open the `.env` file and add your details. Nagi works with both cloud APIs and local models.

To run Nagi, use the launcher script for your system:

- Windows = `nagi.bat`
- Linux = `nagi.sh`

## Usage
Aside from saved queries and @tagging, Nagi includes a few additional features:
### Add context to saved queries
Click on an existing saved query to open the context menu and update its associated context block.
### CLI
Run Nagi directly from terminals as a command-line interface:
```bash
python cli/nagi.py
```
When launched in a VS Code terminal, it detects and reads the directory's files to give the current session local context.
### Customize persona.md
Customize the AI's core behavior and system prompt by editing `persona.md` in your local directory.

This is an ongoing project I plan on improving and evolving over time. Feel free to poke around, fork it, and make it your own.

## License
This project is licensed under the [Apache 2.0 License](LICENSE).
