import chalk from "chalk";
import { Command } from "commander";
import dayjs from "dayjs";
import { coreCompute } from "../core/index.js";

export function cliMain(argv = ["node", "cli", "-n", "500"]) {
  const prog = new Command();
  prog.option("-n <n>", "upper bound", "1000");
  prog.action((o) => {
    const r = coreCompute(parseInt(o.n, 10));
    console.log(chalk.green(`[cli] ${dayjs().format("YYYY-MM-DD")} computed=${r}`));
  });
  prog.parse(argv);
  return "cli-ok";
}
