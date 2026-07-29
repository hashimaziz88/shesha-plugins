// Only the shapes touched at module-import time are needed.
module.exports = {
  createAction: (type, payloadCreator) => {
    const ac = (...args) => ({ type, payload: payloadCreator ? payloadCreator(...args) : args[0] });
    ac.toString = () => type;
    return ac;
  },
  handleActions: (_handlers, defaultState) => (state = defaultState) => state,
};
