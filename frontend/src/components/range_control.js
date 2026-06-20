const DEFAULT_INPUT_CLASS = 'range-value-input';

function progressStyleExpression(model, min, max) {
  const span = max - min;
  return `'--range-progress: ' + Math.min(100, Math.max(0, ((Number(${model} || ${min}) - ${min}) / ${span}) * 100)) + '%'`;
}

export function getRangeControlHTML({
  label,
  model,
  min,
  max,
  step = 1,
  commit,
  hint,
  inputMode = 'numeric',
  pattern = '[0-9]*',
  inputClass = DEFAULT_INPUT_CLASS,
}) {
  const commitHandlers = commit
    ? `@change="${commit}" @blur="${commit}"`
    : '';
  const keydownHandler = commit
    ? `@keydown.enter.prevent="${commit}; $event.target.blur()"`
    : '@keydown.enter.prevent="$event.target.blur()"';

  return `
    <div class="range-control">
      <div class="range-control-header">
        <label class="range-control-label">${label}</label>
        <input type="text"
               x-model="${model}"
               inputmode="${inputMode}"
               pattern="${pattern}"
               ${commitHandlers}
               ${keydownHandler}
               class="${inputClass}">
      </div>
      <input type="range"
             x-model="${model}"
             min="${min}"
             max="${max}"
             step="${step}"
             ${commit ? `@change="${commit}"` : ''}
             :style="${progressStyleExpression(model, min, max)}"
             class="range-slider">
      ${hint ? `<p class="range-control-hint">${hint}</p>` : ''}
    </div>
  `;
}
