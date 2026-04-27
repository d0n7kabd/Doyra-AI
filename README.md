# Doyra AI Music System

This project is a small Python starter kit for training and generating simple Doyra rhythm patterns.
It includes:

- `samples/` for WAV files named after stroke types such as `dom.wav`, `bak.wav`, `rak.wav`, and `rest.wav`
- `data/rhythm_patterns.json` with example rhythm sequences
- `player.py` to play a rhythm pattern with `pygame`
- `train.py` to train a simple LSTM next-stroke model and save it as `model.pt`
- `generate.py` to create a new rhythm pattern from the trained model and play it
- `model_utils.py` for shared dataset and model code

## Project Structure

```text
Doyra-AI/
├── data/
│   └── rhythm_patterns.json
├── samples/
├── generate.py
├── model_utils.py
├── player.py
├── README.md
├── requirements.txt
└── train.py
```

## 1. Install Python Dependencies

Create and activate a virtual environment if you want an isolated setup:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
```

Install the required packages:

```powershell
pip install -r requirements.txt
```

## 2. Add Your WAV Samples

Place WAV files inside `samples/` using stroke names as filenames:

- `samples/dom.wav`
- `samples/bak.wav`
- `samples/rak.wav`
- `samples/rest.wav`

Notes:

- `rest.wav` is optional because `rest` can be treated as silence
- If a sample file is missing, the player uses a silent placeholder and keeps the rhythm timing

## 3. Train the Model

The dataset already contains sample rhythm patterns. Train the model with:

```powershell
python train.py
```

Optional arguments:

```powershell
python train.py --epochs 200 --batch-size 8 --learning-rate 0.005
```

After training, the script saves `model.pt` in the project root.

## 4. Play a Custom Rhythm

You can manually test playback with:

```powershell
python player.py --sequence dom bak rak rest dom rak --bpm 100
```

## 5. Generate and Play a New Rhythm

After training the model, generate a new rhythm:

```powershell
python generate.py --length 16 --seed-sequence dom bak --bpm 100
```

Useful options:

- `--temperature` controls randomness
- `--length` sets the total number of generated strokes
- `--seed-sequence` provides the starting pattern

Example:

```powershell
python generate.py --length 24 --seed-sequence dom rak --temperature 0.8 --bpm 110
```

## Dataset Format

The dataset file is JSON and stores patterns as lists of stroke names:

```json
{
  "patterns": [
    ["dom", "bak", "rak", "rest"],
    ["dom", "dom", "rak", "bak"]
  ]
}
```

You can extend `data/rhythm_patterns.json` with your own patterns at any time.

## Notes

- This is a simple educational baseline, not a production rhythm engine
- The model predicts one stroke at a time based on the previous sequence
- Better results usually need more training data and more varied rhythm examples
