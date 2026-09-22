import _ from "lodash";

export const CORE_NAME = "@app/core";

export function coreCompute(n) {
  const arr = _.range(1, n + 1);
  return _.sum(_.map(arr, (x) => x * x));
}
