const PROCESS_NUMBER_PREFIX = "PROC-";
const PROCESS_NUMBER_WIDTH = 6;

export function formatProcessNumber(number: number): string {
  if (!(Number.isSafeInteger(number) && number > 0)) {
    throw new TypeError("Process number must be a positive safe integer");
  }

  return `${PROCESS_NUMBER_PREFIX}${number.toString().padStart(PROCESS_NUMBER_WIDTH, "0")}`;
}
