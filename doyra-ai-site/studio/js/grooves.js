// Doira grooves for the detected song styles, played by "Auto".
// These are studio designs built from the recorded strokes, NOT research data
// (the research usuls are in usuls.js). 16 steps per bar; '.' = rest.
// Edit freely: each groove follows its style's drum pattern (js/style.js).
export const GROOVES = {
  house:     { name: 'House groove',     steps: 'B.K.B.K.B.K.B.K.' }, // bum on every beat, ta between
  reggaeton: { name: 'Reggaeton groove', steps: 'B..TM.t.B..TM.t.' }, // baks on the dembow accents (3+3+2)
  pop:       { name: 'Pop groove',       steps: 'B.K.T.K.B.K.T.K.' }, // bum on 1 and 3, bak on the backbeat
};
