/**
 * Nexus Tic-Tac-Toe - Upgraded Robust Game Controller
 * Fixed SVG rendering bugs, added defensive checks, and simplified background layers.
 */

// ==========================================================================
// 1. Marker SVG Vectors as Inline Strings (Bypasses Browser SVG Cloning Bugs)
// ==========================================================================
const SVG_MARKER_X = `
  <svg class="marker-icon marker-x" viewBox="0 0 100 100" aria-label="X">
    <path d="M28,28 L72,72" stroke="var(--color-x)" stroke-width="10" stroke-linecap="round" fill="none"></path>
    <path d="M72,28 L28,72" stroke="var(--color-x)" stroke-width="10" stroke-linecap="round" fill="none"></path>
  </svg>
`;

const SVG_MARKER_O = `
  <svg class="marker-icon marker-o" viewBox="0 0 100 100" aria-label="O">
    <circle cx="50" cy="50" r="24" stroke="var(--color-o)" stroke-width="10" stroke-linecap="round" fill="none"></circle>
  </svg>
`;

// ==========================================================================
// 2. Audio Synthesis Manager (Web Audio API)
// ==========================================================================
class SynthAudioManager {
  constructor() {
    this.ctx = null;
    this.volume = 0.3; // 0 to 1
    this.waveform = 'sine'; // 'sine' (Pop), 'square' (Retro), 'triangle' (Pad)
    this.muted = false;
  }

  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playTone(frequency, duration, sweepTo = null, sweepDuration = 0) {
    this.init();
    if (!this.ctx || this.muted || this.volume <= 0.001) return;

    try {
      const osc = this.ctx.createOscillator();
      const noteGain = this.ctx.createGain();
      const masterGain = this.ctx.createGain();

      osc.type = this.waveform;
      osc.frequency.setValueAtTime(frequency, this.ctx.currentTime);
      
      if (sweepTo && sweepDuration > 0) {
        osc.frequency.exponentialRampToValueAtTime(sweepTo, this.ctx.currentTime + sweepDuration);
      }

      // Envelope
      noteGain.gain.setValueAtTime(0, this.ctx.currentTime);
      noteGain.gain.linearRampToValueAtTime(0.35, this.ctx.currentTime + 0.01);
      noteGain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

      // Master Volume
      masterGain.gain.value = this.volume;

      osc.connect(noteGain);
      noteGain.connect(masterGain);
      masterGain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + duration + 0.05);
    } catch (e) {
      console.warn("Audio synthesis error:", e);
    }
  }

  playMove() {
    if (this.waveform === 'sine') {
      this.playTone(320, 0.08, 100, 0.08);
    } else if (this.waveform === 'square') {
      this.playTone(150, 0.06, 600, 0.05);
    } else {
      this.playTone(220, 0.12, 180, 0.1);
    }
  }

  playWin() {
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.50];
    const duration = this.waveform === 'triangle' ? 0.35 : 0.22;
    
    notes.forEach((f, idx) => {
      setTimeout(() => {
        this.playTone(f, duration);
      }, idx * 75);
    });
  }

  playDraw() {
    const notes = [293.66, 277.18];
    notes.forEach((f, idx) => {
      setTimeout(() => {
        this.playTone(f, 0.28);
      }, idx * 100);
    });
  }
}

// ==========================================================================
// 3. Central Game Controller & Board Engine
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  // --- DOM Queries ---
  const loader = document.getElementById('loader');
  const boardContainer = document.getElementById('game-board');
  const turnDisplay = document.getElementById('turn-display');
  const scoreValX = document.getElementById('score-val-x');
  const scoreValO = document.getElementById('score-val-o');
  const scoreValDraw = document.getElementById('score-val-draw');
  
  // Controls
  const typeClassicBtn = document.getElementById('type-classic');
  const typeUltimateBtn = document.getElementById('type-ultimate');
  const modePvpBtn = document.getElementById('mode-pvp');
  const modePvcBtn = document.getElementById('mode-pvc');
  const diffWrapper = document.getElementById('difficulty-wrapper');
  const diffEasyBtn = document.getElementById('diff-easy');
  const diffHardBtn = document.getElementById('diff-hard');
  
  // Sound controls
  const muteBtn = document.getElementById('mute-toggle');
  const speakerOnIcon = muteBtn.querySelector('.speaker-on-icon');
  const speakerOffIcon = muteBtn.querySelector('.speaker-off-icon');
  const synthSelect = document.getElementById('synth-waveform');
  const volumeSlider = document.getElementById('volume-control');
  const volumeValText = document.getElementById('volume-value');
  
  // Reset Action Buttons
  const btnRestart = document.getElementById('btn-restart');
  const btnResetScores = document.getElementById('btn-reset-scores');

  // Modal actions
  const modalBtnNext = document.getElementById('modal-btn-next');
  const modalBtnReset = document.getElementById('modal-btn-reset');
  const resultVisual = document.getElementById('result-visual');
  const resultText = document.getElementById('result-text');

  // --- Constants ---
  const winCombinations = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];

  // --- Game State Variables ---
  let gameType = 'classic';
  let gameMode = 'pvp';
  let aiDifficulty = 'easy';
  let currentPlayer = 'X';
  let isGameActive = true;
  let isAiThinking = false;
  let scores = { X: 0, O: 0, draws: 0 };

  let classicBoard = Array(9).fill('');
  let ultimateBoard = Array(9).fill(null).map(() => Array(9).fill(''));
  let ultimateGlobalBoard = Array(9).fill('');
  let activeSubBoard = null;

  // Initialize Audio context
  const audio = new SynthAudioManager();

  // Hide loader
  setTimeout(() => {
    if (loader) loader.classList.add('loader-fadeout');
    document.body.addEventListener('click', () => audio.init(), { once: true });
  }, 1000);

  // ==========================================================================
  // Settings & Theme Presets Persistence
  // ==========================================================================
  function loadPersistedSettings() {
    const savedWaveform = localStorage.getItem('nexus-audio-waveform') || 'sine';
    if (synthSelect) synthSelect.value = savedWaveform;
    audio.waveform = savedWaveform;

    const savedVolume = localStorage.getItem('nexus-audio-volume') || '30';
    if (volumeSlider) volumeSlider.value = savedVolume;
    audio.volume = parseFloat(savedVolume) / 100;
    if (volumeValText) volumeValText.textContent = `${savedVolume}%`;
  }

  // Speaker Mute button toggle
  muteBtn.addEventListener('click', () => {
    audio.muted = !audio.muted;
    if (audio.muted) {
      if (speakerOnIcon) speakerOnIcon.style.display = 'none';
      if (speakerOffIcon) speakerOffIcon.style.display = 'block';
      muteBtn.setAttribute('aria-label', 'Unmute game sounds');
    } else {
      if (speakerOnIcon) speakerOnIcon.style.display = 'block';
      if (speakerOffIcon) speakerOffIcon.style.display = 'none';
      muteBtn.setAttribute('aria-label', 'Mute game sounds');
    }
  });

  if (synthSelect) {
    synthSelect.addEventListener('change', (e) => {
      audio.waveform = e.target.value;
      localStorage.setItem('nexus-audio-waveform', e.target.value);
    });
  }

  if (volumeSlider) {
    volumeSlider.addEventListener('input', (e) => {
      const val = e.target.value;
      audio.volume = parseFloat(val) / 100;
      if (volumeValText) volumeValText.textContent = `${val}%`;
      localStorage.setItem('nexus-audio-volume', val);
    });
  }

  // Classic vs Ultimate Game Type toggling
  typeClassicBtn.addEventListener('click', () => {
    if (gameType === 'classic') return;
    setGameType('classic');
    resetScores();
  });

  typeUltimateBtn.addEventListener('click', () => {
    if (gameType === 'ultimate') return;
    setGameType('ultimate');
    resetScores();
  });

  function setGameType(type) {
    gameType = type;
    if (type === 'classic') {
      typeClassicBtn.classList.add('active');
      typeClassicBtn.setAttribute('aria-checked', 'true');
      typeClassicBtn.setAttribute('tabindex', '0');
      
      typeUltimateBtn.classList.remove('active');
      typeUltimateBtn.setAttribute('aria-checked', 'false');
      typeUltimateBtn.setAttribute('tabindex', '-1');
      
      if (boardContainer) boardContainer.className = 'board-grid classic-mode';
    } else {
      typeUltimateBtn.classList.add('active');
      typeUltimateBtn.setAttribute('aria-checked', 'true');
      typeUltimateBtn.setAttribute('tabindex', '0');
      
      typeClassicBtn.classList.remove('active');
      typeClassicBtn.setAttribute('aria-checked', 'false');
      typeClassicBtn.setAttribute('tabindex', '-1');
      
      if (boardContainer) boardContainer.className = 'board-grid ultimate-mode';
    }
    initializeGrid();
  }

  // Mode Selection (PvP vs PvC)
  modePvpBtn.addEventListener('click', () => {
    if (gameMode === 'pvp') return;
    setGameMode('pvp');
    restartMatch();
  });

  modePvcBtn.addEventListener('click', () => {
    if (gameMode === 'pvc') return;
    setGameMode('pvc');
    restartMatch();
  });

  function setGameMode(mode) {
    gameMode = mode;
    if (mode === 'pvp') {
      modePvpBtn.classList.add('active');
      modePvpBtn.setAttribute('aria-checked', 'true');
      modePvpBtn.setAttribute('tabindex', '0');
      
      modePvcBtn.classList.remove('active');
      modePvcBtn.setAttribute('aria-checked', 'false');
      modePvcBtn.setAttribute('tabindex', '-1');
      
      if (diffWrapper) diffWrapper.classList.add('hidden');
    } else {
      modePvcBtn.classList.add('active');
      modePvcBtn.setAttribute('aria-checked', 'true');
      modePvcBtn.setAttribute('tabindex', '0');
      
      modePvpBtn.classList.remove('active');
      modePvpBtn.setAttribute('aria-checked', 'false');
      modePvpBtn.setAttribute('tabindex', '-1');
      
      if (diffWrapper) diffWrapper.classList.remove('hidden');
    }
  }

  diffEasyBtn.addEventListener('click', () => {
    if (aiDifficulty === 'easy') return;
    setDifficulty('easy');
    restartMatch();
  });

  diffHardBtn.addEventListener('click', () => {
    if (aiDifficulty === 'hard') return;
    setDifficulty('hard');
    restartMatch();
  });

  function setDifficulty(diff) {
    aiDifficulty = diff;
    if (diff === 'easy') {
      diffEasyBtn.classList.add('active');
      diffEasyBtn.setAttribute('aria-checked', 'true');
      diffEasyBtn.setAttribute('tabindex', '0');
      
      diffHardBtn.classList.remove('active');
      diffHardBtn.setAttribute('aria-checked', 'false');
      diffHardBtn.setAttribute('tabindex', '-1');
    } else {
      diffHardBtn.classList.add('active');
      diffHardBtn.setAttribute('aria-checked', 'true');
      diffHardBtn.setAttribute('tabindex', '0');
      
      diffEasyBtn.classList.remove('active');
      diffEasyBtn.setAttribute('aria-checked', 'false');
      diffEasyBtn.setAttribute('tabindex', '-1');
    }
  }

  // ==========================================================================
  // Board Grid Rendering & Dynamic Appending
  // ==========================================================================
  function initializeGrid() {
    if (!boardContainer) return;
    boardContainer.innerHTML = '';
    
    // Defensive reset of SVG Laser overlay
    const laserLine = document.getElementById('laser-line');
    if (laserLine) {
      laserLine.className = 'laser-line-element hidden-line';
      laserLine.classList.remove('active-slice');
      laserLine.setAttribute('x1', '0');
      laserLine.setAttribute('y1', '0');
      laserLine.setAttribute('x2', '0');
      laserLine.setAttribute('y2', '0');
    }

    if (gameType === 'classic') {
      // Classic Mode: Render 9 cell buttons
      for (let i = 0; i < 9; i++) {
        const button = document.createElement('button');
        button.className = 'board-cell';
        button.setAttribute('data-index', i);
        button.setAttribute('role', 'gridcell');
        button.setAttribute('aria-label', `Cell ${i + 1}, Empty`);
        button.setAttribute('tabindex', '0');
        
        button.setAttribute('data-row', Math.floor(i / 3));
        button.setAttribute('data-col', i % 3);
        
        button.addEventListener('click', handleCellClick);
        boardContainer.appendChild(button);
      }
    } else {
      // Ultimate Mode: Render 3x3 outer boards containing small buttons
      for (let s = 0; s < 9; s++) {
        const subBoardWrap = document.createElement('div');
        subBoardWrap.className = 'sub-board';
        subBoardWrap.setAttribute('data-subboard-index', s);
        
        for (let c = 0; c < 9; c++) {
          const button = document.createElement('button');
          button.className = 'board-cell cell-small';
          button.setAttribute('data-subboard', s);
          button.setAttribute('data-cell', c);
          button.setAttribute('role', 'gridcell');
          button.setAttribute('aria-label', `Board ${s + 1}, Cell ${c + 1}, Empty`);
          button.setAttribute('tabindex', '0');

          // Mapping 9x9 indices for arrow key grid movements
          const globalRow = Math.floor(s / 3) * 3 + Math.floor(c / 3);
          const globalCol = (s % 3) * 3 + (c % 3);
          button.setAttribute('data-row', globalRow);
          button.setAttribute('data-col', globalCol);

          button.addEventListener('click', handleCellClick);
          subBoardWrap.appendChild(button);
        }
        boardContainer.appendChild(subBoardWrap);
      }
    }
    
    bindGridKeyboardNav();
  }

  function bindGridKeyboardNav() {
    if (!boardContainer) return;
    const cells = boardContainer.querySelectorAll('.board-cell');
    cells.forEach(cell => {
      cell.addEventListener('keydown', (e) => {
        let r = parseInt(cell.getAttribute('data-row'));
        let c = parseInt(cell.getAttribute('data-col'));
        const sizeLimit = gameType === 'classic' ? 3 : 9;

        switch (e.key) {
          case 'ArrowUp':
            r = (r - 1 + sizeLimit) % sizeLimit;
            break;
          case 'ArrowDown':
            r = (r + 1) % sizeLimit;
            break;
          case 'ArrowLeft':
            c = (c - 1 + sizeLimit) % sizeLimit;
            break;
          case 'ArrowRight':
            c = (c + 1) % sizeLimit;
            break;
          case 'Home':
            r = 0; c = 0;
            break;
          case 'End':
            r = sizeLimit - 1; c = sizeLimit - 1;
            break;
          default:
            return;
        }
        
        e.preventDefault();
        const nextCell = boardContainer.querySelector(`.board-cell[data-row="${r}"][data-col="${c}"]`);
        if (nextCell) nextCell.focus();
      });
    });
  }

  // ==========================================================================
  // Core Gameplay Loops
  // ==========================================================================
  function handleCellClick(e) {
    const cell = e.currentTarget;
    if (!isGameActive || isAiThinking) return;

    if (gameType === 'classic') {
      const idx = parseInt(cell.getAttribute('data-index'));
      if (classicBoard[idx] !== '') return;
      
      makeClassicMove(idx, currentPlayer);
      if (checkClassicGameStatus()) return;
      
      switchPlayer();
      if (gameMode === 'pvc') {
        triggerAiMove();
      }
    } else {
      const subIdx = parseInt(cell.getAttribute('data-subboard'));
      const cellIdx = parseInt(cell.getAttribute('data-cell'));

      // Validate Ultimate restrictions
      if (ultimateGlobalBoard[subIdx] !== '') return;
      if (activeSubBoard !== null && activeSubBoard !== subIdx) return;
      if (ultimateBoard[subIdx][cellIdx] !== '') return;

      makeUltimateMove(subIdx, cellIdx, currentPlayer);
      if (checkUltimateGameStatus()) return;
      
      switchPlayer();
      if (gameMode === 'pvc') {
        triggerAiMove();
      }
    }
  }

  function makeClassicMove(idx, player) {
    classicBoard[idx] = player;
    audio.playMove();

    const cell = boardContainer ? boardContainer.querySelector(`.board-cell[data-index="${idx}"]`) : null;
    if (cell) {
      cell.disabled = true;
      cell.innerHTML = player === 'X' ? SVG_MARKER_X : SVG_MARKER_O;
      cell.setAttribute('aria-label', `Occupied by Player ${player}`);
    }
  }

  function checkClassicGameStatus() {
    const status = check3x3Winner(classicBoard);
    
    if (status) {
      isGameActive = false;
      isAiThinking = false; // Ensure AI thinking resets on game-over
      highlightClassicWinCells(status.pattern, status.winner);
      audio.playWin();
      
      drawLaserOverlayLine(status.pattern, 'classic');

      scores[status.winner]++;
      updateScoresUI();
      
      setTimeout(() => showGameOverModal(status.winner), 900);
      return true;
    }

    if (classicBoard.every(cell => cell !== '')) {
      isGameActive = false;
      isAiThinking = false; // Ensure AI thinking resets on game-over
      audio.playDraw();
      scores.draws++;
      updateScoresUI();
      setTimeout(() => showGameOverModal('draw'), 700);
      return true;
    }

    return false;
  }

  // Highlight cells on victory
  function highlightClassicWinCells(pattern, winner) {
    if (!boardContainer) return;
    const winClass = winner === 'X' ? 'win-highlight-x' : 'win-highlight-o';
    pattern.forEach(idx => {
      const cell = boardContainer.querySelector(`.board-cell[data-index="${idx}"]`);
      if (cell) cell.classList.add(winClass);
    });
  }

  // --- Ultimate Move Loop ---
  function makeUltimateMove(subIdx, cellIdx, player) {
    ultimateBoard[subIdx][cellIdx] = player;
    audio.playMove();

    const cellBtn = boardContainer ? boardContainer.querySelector(`.board-cell[data-subboard="${subIdx}"][data-cell="${cellIdx}"]`) : null;
    if (cellBtn) {
      cellBtn.disabled = true;
      cellBtn.innerHTML = player === 'X' ? SVG_MARKER_X : SVG_MARKER_O;
      cellBtn.setAttribute('aria-label', `Board ${subIdx + 1}, Cell ${cellIdx + 1}, occupied by Player ${player}`);
    }

    // Check subboard win state
    const subWinner = check3x3Winner(ultimateBoard[subIdx]);
    if (subWinner) {
      ultimateGlobalBoard[subIdx] = subWinner.winner;
      createSubBoardOverlay(subIdx, subWinner.winner);
    } else if (ultimateBoard[subIdx].every(c => c !== '')) {
      ultimateGlobalBoard[subIdx] = 'draw';
      createSubBoardOverlay(subIdx, 'draw');
    }

    // Set next sub-board restriction
    if (ultimateGlobalBoard[cellIdx] === '') {
      activeSubBoard = cellIdx;
    } else {
      activeSubBoard = null;
    }

    updateActiveSubboardUI();
  }

  function createSubBoardOverlay(subIdx, winner) {
    if (!boardContainer) return;
    const subBoardCard = boardContainer.querySelector(`[data-subboard-index="${subIdx}"]`);
    if (!subBoardCard) return;

    const overlay = document.createElement('div');
    overlay.className = `sub-board-overlay`;
    
    if (winner === 'draw') {
      overlay.classList.add('overlay-draw');
      overlay.textContent = 'Draw';
    } else {
      overlay.classList.add(winner === 'X' ? 'overlay-x' : 'overlay-o');
      overlay.innerHTML = winner === 'X' ? SVG_MARKER_X : SVG_MARKER_O;
    }
    
    subBoardCard.appendChild(overlay);
    subBoardCard.querySelectorAll('.board-cell').forEach(btn => btn.disabled = true);
  }

  function updateActiveSubboardUI() {
    if (!boardContainer) return;
    const subboards = boardContainer.querySelectorAll('.sub-board');
    
    if (activeSubBoard === null) {
      boardContainer.classList.remove('has-active-restriction');
      subboards.forEach((card, idx) => {
        card.classList.remove('active-sub-board');
        if (ultimateGlobalBoard[idx] === '') {
          card.style.opacity = '1';
        }
      });
    } else {
      boardContainer.classList.add('has-active-restriction');
      subboards.forEach((card, idx) => {
        if (idx === activeSubBoard) {
          card.classList.add('active-sub-board');
          card.style.opacity = '1';
        } else {
          card.classList.remove('active-sub-board');
        }
      });
    }
  }

  function checkUltimateGameStatus() {
    const status = check3x3Winner(ultimateGlobalBoard);
    
    if (status) {
      isGameActive = false;
      isAiThinking = false; // Ensure AI thinking resets on game-over
      audio.playWin();
      
      drawLaserOverlayLine(status.pattern, 'ultimate');

      scores[status.winner]++;
      updateScoresUI();
      
      setTimeout(() => showGameOverModal(status.winner), 900);
      return true;
    }

    if (ultimateGlobalBoard.every(boardVal => boardVal !== '')) {
      isGameActive = false;
      isAiThinking = false; // Ensure AI thinking resets on game-over
      audio.playDraw();
      scores.draws++;
      updateScoresUI();
      setTimeout(() => showGameOverModal('draw'), 700);
      return true;
    }

    return false;
  }

  function check3x3Winner(gridState) {
    for (let pattern of winCombinations) {
      if (gridState[pattern[0]] !== '' && 
          gridState[pattern[0]] !== 'draw' &&
          gridState[pattern[0]] === gridState[pattern[1]] && 
          gridState[pattern[0]] === gridState[pattern[2]]) {
        return { winner: gridState[pattern[0]], pattern };
      }
    }
    return null;
  }

  function switchPlayer() {
    currentPlayer = currentPlayer === 'X' ? 'O' : 'X';
    if (turnDisplay) {
      turnDisplay.className = `turn-badge turn-${currentPlayer.toLowerCase()}`;
      const turnLetter = turnDisplay.querySelector('.turn-letter');
      if (turnLetter) turnLetter.textContent = currentPlayer;
    }
  }

  // --- SVG Laser Slicer Solver ---
  function drawLaserOverlayLine(pattern, mode) {
    const boardWrapper = document.querySelector('.board-wrapper');
    const laserLine = document.getElementById('laser-line');
    if (!boardContainer || !boardWrapper || !laserLine) return;

    let startCell, endCell;
    
    if (mode === 'classic') {
      startCell = boardContainer.querySelector(`[data-index="${pattern[0]}"]`);
      endCell = boardContainer.querySelector(`[data-index="${pattern[2]}"]`);
    } else {
      startCell = boardContainer.querySelector(`[data-subboard-index="${pattern[0]}"]`);
      endCell = boardContainer.querySelector(`[data-subboard-index="${pattern[2]}"]`);
    }
    
    // Defensive check to block null element crashes
    if (!startCell || !endCell) {
      console.warn("Laser centers missing from DOM grid!");
      return;
    }

    const parentRect = boardWrapper.getBoundingClientRect();
    const startRect = startCell.getBoundingClientRect();
    const endRect = endCell.getBoundingClientRect();
    
    const x1 = startRect.left + startRect.width / 2 - parentRect.left;
    const y1 = startRect.top + startRect.height / 2 - parentRect.top;
    
    const x2 = endRect.left + endRect.width / 2 - parentRect.left;
    const y2 = endRect.top + endRect.height / 2 - parentRect.top;
    
    laserLine.setAttribute('x1', x1);
    laserLine.setAttribute('y1', y1);
    laserLine.setAttribute('x2', x2);
    laserLine.setAttribute('y2', y2);

    const winClass = currentPlayer === 'X' ? 'x-win' : 'o-win';
    laserLine.className = `laser-line-element ${winClass}`;
    
    laserLine.classList.remove('hidden-line');
    void laserLine.offsetWidth; 
    laserLine.classList.add('active-slice');
  }

  // ==========================================================================
  // Artificial Intelligence Solvers
  // ==========================================================================
  function triggerAiMove() {
    isAiThinking = true;
    
    setTimeout(() => {
      if (!isGameActive) {
        isAiThinking = false;
        return;
      }

      let decisionIdx;
      
      if (gameType === 'classic') {
        if (aiDifficulty === 'easy') {
          decisionIdx = pickRandomClassicMove();
        } else {
          decisionIdx = getBestClassicMinimaxMove();
        }
        makeClassicMove(decisionIdx, 'O');
        
        if (checkClassicGameStatus()) return;
        switchPlayer();
      } else {
        const bestMove = getBestUltimateMove();
        makeUltimateMove(bestMove.subIdx, bestMove.cellIdx, 'O');
        
        if (checkUltimateGameStatus()) return;
        switchPlayer();
      }
      
      isAiThinking = false;
    }, 600);
  }

  function pickRandomClassicMove() {
    const free = [];
    classicBoard.forEach((v, i) => { if (v === '') free.push(i); });
    return free[Math.floor(Math.random() * free.length)];
  }

  function getBestClassicMinimaxMove() {
    let bestScore = -Infinity;
    let bestMove = -1;
    
    const emptyCount = classicBoard.filter(c => c === '').length;
    if (emptyCount === 9) return 4;
    if (emptyCount === 8 && classicBoard[4] === '') return 4;

    for (let i = 0; i < 9; i++) {
      if (classicBoard[i] === '') {
        classicBoard[i] = 'O';
        let score = minimaxClassic(classicBoard, 0, false);
        classicBoard[i] = '';
        
        if (score > bestScore) {
          bestScore = score;
          bestMove = i;
        }
      }
    }
    return bestMove;
  }

  function minimaxClassic(tempBoard, depth, isMaximizing) {
    const status = check3x3Winner(tempBoard);
    if (status) {
      if (status.winner === 'O') return 10 - depth;
      if (status.winner === 'X') return depth - 10;
    }
    if (tempBoard.every(c => c !== '')) return 0;

    if (isMaximizing) {
      let maxScore = -Infinity;
      for (let i = 0; i < 9; i++) {
        if (tempBoard[i] === '') {
          tempBoard[i] = 'O';
          let score = minimaxClassic(tempBoard, depth + 1, false);
          tempBoard[i] = '';
          maxScore = Math.max(score, maxScore);
        }
      }
      return maxScore;
    } else {
      let minScore = Infinity;
      for (let i = 0; i < 9; i++) {
        if (tempBoard[i] === '') {
          tempBoard[i] = 'X';
          let score = minimaxClassic(tempBoard, depth + 1, true);
          tempBoard[i] = '';
          minScore = Math.min(score, minScore);
        }
      }
      return minScore;
    }
  }

  // --- Ultimate AI Alpha-Beta Solver ---
  function getBestUltimateMove() {
    const moves = getValidUltimateMoves(ultimateBoard, ultimateGlobalBoard, activeSubBoard);
    
    if (aiDifficulty === 'easy' || moves.length === 1) {
      return moves[Math.floor(Math.random() * moves.length)];
    }

    let bestScore = -Infinity;
    let bestMove = moves[0];

    for (let move of moves) {
      const prevGlobal = ultimateGlobalBoard[move.subIdx];
      const prevActive = activeSubBoard;
      
      ultimateBoard[move.subIdx][move.cellIdx] = 'O';
      
      const subWinner = check3x3Winner(ultimateBoard[move.subIdx]);
      if (subWinner) {
        ultimateGlobalBoard[move.subIdx] = subWinner.winner;
      } else if (ultimateBoard[move.subIdx].every(c => c !== '')) {
        ultimateGlobalBoard[move.subIdx] = 'draw';
      }

      const nextActive = ultimateGlobalBoard[move.cellIdx] === '' ? move.cellIdx : null;
      
      let score = minimaxUltimate(ultimateBoard, ultimateGlobalBoard, 0, nextActive, -Infinity, Infinity, false);

      ultimateBoard[move.subIdx][move.cellIdx] = '';
      ultimateGlobalBoard[move.subIdx] = prevGlobal;
      activeSubBoard = prevActive;

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }

    return bestMove;
  }

  function getValidUltimateMoves(uBoard, uGlobal, subRestricted) {
    const valid = [];
    
    if (subRestricted !== null && uGlobal[subRestricted] === '') {
      for (let c = 0; c < 9; c++) {
        if (uBoard[subRestricted][c] === '') {
          valid.push({ subIdx: subRestricted, cellIdx: c });
        }
      }
    } else {
      for (let s = 0; s < 9; s++) {
        if (uGlobal[s] === '') {
          for (let c = 0; c < 9; c++) {
            if (uBoard[s][c] === '') {
              valid.push({ subIdx: s, cellIdx: c });
            }
          }
        }
      }
    }
    
    return valid;
  }

  function minimaxUltimate(uBoard, uGlobal, depth, subRestricted, alpha, beta, isMaximizing) {
    const winStatus = check3x3Winner(uGlobal);
    if (winStatus) {
      return winStatus.winner === 'O' ? (10000 - depth) : (depth - 10000);
    }
    if (uGlobal.every(g => g !== '')) return 0;
    
    if (depth >= 3) {
      return evaluateUltimateBoard(uBoard, uGlobal);
    }

    const moves = getValidUltimateMoves(uBoard, uGlobal, subRestricted);
    if (moves.length === 0) return 0;

    if (isMaximizing) {
      let maxScore = -Infinity;
      for (let move of moves) {
        const prevG = uGlobal[move.subIdx];
        uBoard[move.subIdx][move.cellIdx] = 'O';
        
        const subWinner = check3x3Winner(uBoard[move.subIdx]);
        if (subWinner) uGlobal[move.subIdx] = subWinner.winner;
        else if (uBoard[move.subIdx].every(c => c !== '')) uGlobal[move.subIdx] = 'draw';

        const nextActive = uGlobal[move.cellIdx] === '' ? move.cellIdx : null;

        let score = minimaxUltimate(uBoard, uGlobal, depth + 1, nextActive, alpha, beta, false);
        
        uBoard[move.subIdx][move.cellIdx] = '';
        uGlobal[move.subIdx] = prevG;

        maxScore = Math.max(score, maxScore);
        alpha = Math.max(alpha, score);
        if (beta <= alpha) break;
      }
      return maxScore;
    } else {
      let minScore = Infinity;
      for (let move of moves) {
        const prevG = uGlobal[move.subIdx];
        uBoard[move.subIdx][move.cellIdx] = 'X';
        
        const subWinner = check3x3Winner(uBoard[move.subIdx]);
        if (subWinner) uGlobal[move.subIdx] = subWinner.winner;
        else if (uBoard[move.subIdx].every(c => c !== '')) uGlobal[move.subIdx] = 'draw';

        const nextActive = uGlobal[move.cellIdx] === '' ? move.cellIdx : null;

        let score = minimaxUltimate(uBoard, uGlobal, depth + 1, nextActive, alpha, beta, true);

        uBoard[move.subIdx][move.cellIdx] = '';
        uGlobal[move.subIdx] = prevG;

        minScore = Math.min(score, minScore);
        beta = Math.min(beta, score);
        if (beta <= alpha) break;
      }
      return minScore;
    }
  }

  function evaluateUltimateBoard(uBoard, uGlobal) {
    let score = 0;
    for (let s = 0; s < 9; s++) {
      if (uGlobal[s] === 'O') score += 120;
      else if (uGlobal[s] === 'X') score -= 120;
      else {
        score += evaluate3x3Subboard(uBoard[s]);
      }
    }
    score += evaluate3x3Subboard(uGlobal) * 15;
    return score;
  }

  function evaluate3x3Subboard(grid) {
    let localScore = 0;
    
    if (grid[4] === 'O') localScore += 5;
    else if (grid[4] === 'X') localScore -= 5;
    
    [0, 2, 6, 8].forEach(idx => {
      if (grid[idx] === 'O') localScore += 1.5;
      else if (grid[idx] === 'X') localScore -= 1.5;
    });

    for (let pat of winCombinations) {
      const v0 = grid[pat[0]];
      const v1 = grid[pat[1]];
      const v2 = grid[pat[2]];
      
      if ((v0 === 'O' && v1 === 'O' && v2 === '') ||
          (v0 === 'O' && v2 === 'O' && v1 === '') ||
          (v1 === 'O' && v2 === 'O' && v0 === '')) {
        localScore += 15;
      }
      if ((v0 === 'X' && v1 === 'X' && v2 === '') ||
          (v0 === 'X' && v2 === 'X' && v1 === '') ||
          (v1 === 'X' && v2 === 'X' && v0 === '')) {
        localScore -= 15;
      }
    }
    
    return localScore;
  }

  // ==========================================================================
  // Scoreboard, Modals & Control Actions
  // ==========================================================================
  function updateScoresUI() {
    if (scoreValX) scoreValX.textContent = scores.X;
    if (scoreValO) scoreValO.textContent = scores.O;
    if (scoreValDraw) scoreValDraw.textContent = scores.draws;
    
    if (scoreValX) animateScoreScale(scoreValX);
    if (scoreValO) animateScoreScale(scoreValO);
    if (scoreValDraw) animateScoreScale(scoreValDraw);
  }

  function animateScoreScale(el) {
    el.style.transform = 'scale(1.25)';
    el.style.transition = 'transform 0.08s ease';
    setTimeout(() => {
      el.style.transform = 'scale(1)';
      el.style.transition = 'transform 0.25s ease';
    }, 100);
  }

  function showGameOverModal(winner) {
    console.log("Game Over Triggered! Winner:", winner);
    const gameOverModal = document.getElementById('game-over-modal');
    const resultVisual = document.getElementById('result-visual');
    const resultText = document.getElementById('result-text');
    if (!gameOverModal || !resultVisual || !resultText) {
      console.warn("Failed to find game over modal elements in DOM!");
      return;
    }
    
    resultVisual.innerHTML = '';
    
    if (winner === 'draw') {
      resultText.textContent = "It's a Draw!";
      resultText.style.color = 'var(--color-draw)';
      resultVisual.innerHTML = '<span style="font-size: 3.5rem;">🤝</span>';
    } else {
      resultText.textContent = `Player ${winner} Wins!`;
      resultText.style.color = winner === 'X' ? 'var(--color-x)' : 'var(--color-o)';
      resultVisual.innerHTML = winner === 'X' ? SVG_MARKER_X : SVG_MARKER_O;
    }
    
    gameOverModal.classList.remove('hidden');
    console.log("Removed 'hidden' from game-over-modal. Current classList:", gameOverModal.className);
    if (modalBtnNext) modalBtnNext.focus();
  }

  function hideGameOverModal() {
    const gameOverModal = document.getElementById('game-over-modal');
    if (gameOverModal) gameOverModal.classList.add('hidden');
  }

  function restartMatch() {
    isGameActive = true;
    currentPlayer = 'X';
    isAiThinking = false;
    
    classicBoard = Array(9).fill('');
    ultimateBoard = Array(9).fill(null).map(() => Array(9).fill(''));
    ultimateGlobalBoard = Array(9).fill('');
    activeSubBoard = null;

    if (turnDisplay) {
      turnDisplay.className = `turn-badge turn-x`;
      const turnLetter = turnDisplay.querySelector('.turn-letter');
      if (turnLetter) turnLetter.textContent = 'X';
    }

    initializeGrid();
    hideGameOverModal();
  }

  function resetScores() {
    scores = { X: 0, O: 0, draws: 0 };
    updateScoresUI();
    restartMatch();
  }

  // Bind clicks
  if (btnRestart) btnRestart.addEventListener('click', restartMatch);
  if (btnResetScores) btnResetScores.addEventListener('click', resetScores);
  
  if (modalBtnNext) modalBtnNext.addEventListener('click', restartMatch);
  if (modalBtnReset) modalBtnReset.addEventListener('click', resetScores);

  // Setup Initials
  loadPersistedSettings();
  initializeGrid();
});
