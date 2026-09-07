const BOARD_SIZE = 15;
const CELL_COUNT = BOARD_SIZE * BOARD_SIZE;

export function createGomokuState() {
  return {
    version: 1,
    size: BOARD_SIZE,
    board: Array(CELL_COUNT).fill(0),
    moves: [],
    winner: null,
    status: 'playing',
  };
}

function winningLine(board, row, column, player) {
  const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
  return directions.some(([rowStep, columnStep]) => {
    let count = 1;
    for (const direction of [-1, 1]) {
      let nextRow = row + rowStep * direction;
      let nextColumn = column + columnStep * direction;
      while (
        nextRow >= 0 && nextRow < BOARD_SIZE
        && nextColumn >= 0 && nextColumn < BOARD_SIZE
        && board[nextRow * BOARD_SIZE + nextColumn] === player
      ) {
        count += 1;
        nextRow += rowStep * direction;
        nextColumn += columnStep * direction;
      }
    }
    return count >= 5;
  });
}

export function validateGomokuAction(state, action) {
  const row = Number(action?.row);
  const column = Number(action?.column);
  if (state?.status !== 'playing') throw new Error('对局已经结束');
  if (!Number.isInteger(row) || !Number.isInteger(column)) throw new Error('落子行列必须是整数');
  if (row < 1 || row > BOARD_SIZE || column < 1 || column > BOARD_SIZE) throw new Error('落子超出 15×15 棋盘');
  if (state.board[(row - 1) * BOARD_SIZE + column - 1] !== 0) throw new Error('该位置已有棋子');
  return {
    row,
    column,
    comment: typeof action?.comment === 'string' ? action.comment.trim().slice(0, 160) : '',
  };
}

export function applyGomokuAction(state, action, participantIndex, agentId, agentName) {
  const valid = validateGomokuAction(state, action);
  const player = participantIndex + 1;
  const board = [...state.board];
  board[(valid.row - 1) * BOARD_SIZE + valid.column - 1] = player;
  const move = {
    number: state.moves.length + 1,
    player,
    agentId,
    agentName,
    ...valid,
  };
  const won = winningLine(board, valid.row - 1, valid.column - 1, player);
  const draw = !won && move.number >= CELL_COUNT;
  return {
    ...state,
    version: Number(state.version || 0) + 1,
    board,
    moves: [...state.moves, move],
    winner: won ? player : null,
    status: won ? 'won' : draw ? 'draw' : 'playing',
  };
}

export function gomokuStateText(state) {
  const symbols = ['·', '●', '○'];
  const rows = [];
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    rows.push(state.board.slice(row * BOARD_SIZE, (row + 1) * BOARD_SIZE).map((cell) => symbols[cell] || '·').join(' '));
  }
  return rows.join('\n');
}

export function gomokuResult(state) {
  if (state.status === 'won') {
    const move = state.moves.at(-1);
    return `${move?.agentName || `玩家 ${state.winner}`} 获胜，共进行 ${state.moves.length} 手。`;
  }
  if (state.status === 'draw') return `棋盘已满，本局和棋，共进行 ${state.moves.length} 手。`;
  return '';
}

export function gomokuPreviewHtml() {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>接力协作 · 五子棋</title><style>
*{box-sizing:border-box}body{margin:0;background:#f6f7f8;color:#17191c;font-family:system-ui,sans-serif}.wrap{width:min(94vw,760px);margin:32px auto}header{display:flex;align-items:end;justify-content:space-between;margin-bottom:18px}h1{margin:0;font-size:22px}.meta{font-size:13px;color:#67717e}.board{display:grid;grid-template-columns:repeat(15,1fr);aspect-ratio:1;background:#d9a85d;border:1px solid #9c6b2d;box-shadow:0 12px 34px #1f29371f}.cell{position:relative;border-right:1px solid #805a2f66;border-bottom:1px solid #805a2f66}.stone{position:absolute;inset:9%;border-radius:50%;box-shadow:0 2px 4px #0005}.black{background:#17191c}.white{background:#f8fafc;border:1px solid #b8c0ca}.empty{display:none}@media(max-width:560px){.wrap{margin:16px auto}.stone{inset:6%}}
</style></head><body><main class="wrap"><header><div><h1>五子棋接力</h1><div class="meta" id="status">读取对局...</div></div><div class="meta" id="moves"></div></header><div class="board" id="board"></div></main><script>
async function render(){const state=await fetch('./state.json',{cache:'no-store'}).then(r=>r.json());const board=document.querySelector('#board');board.replaceChildren(...state.board.map((cell)=>{const node=document.createElement('div');node.className='cell';const stone=document.createElement('i');stone.className='stone '+(cell===1?'black':cell===2?'white':'empty');node.append(stone);return node}));document.querySelector('#moves').textContent=state.moves.length+' 手';const last=state.moves.at(-1);document.querySelector('#status').textContent=state.status==='won'?(last.agentName+' 获胜'):state.status==='draw'?'和棋':last?('刚刚：'+last.agentName+' · '+last.row+','+last.column):'等待第一步';}render();setInterval(render,1500);
</script></body></html>`;
}
