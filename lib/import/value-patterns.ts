const IMPORT_VALUE_NUMERIC_TOKEN_PATTERN =
  "(?:[#＃]\\s*)?(?:[$¥€£]\\s*)?[+-]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?";
const IMPORT_VALUE_ATTACHED_MARKER_PATTERN = "(?:[*∗﹡✱✳✻](?!://)|\\^)(?:[0-9A-Za-z]*)?";
const IMPORT_VALUE_PAIR_SEGMENT_PATTERN =
  `${IMPORT_VALUE_NUMERIC_TOKEN_PATTERN}(?:${IMPORT_VALUE_ATTACHED_MARKER_PATTERN})?`;

export const IMPORT_VALUE_PAIR_REGEX =
  new RegExp(`^(${IMPORT_VALUE_PAIR_SEGMENT_PATTERN})\\s*\\/\\s*(${IMPORT_VALUE_PAIR_SEGMENT_PATTERN})(.*)$`);

export const IMPORT_VALUE_SINGLE_REGEX =
  /^((?:[#＃]\s*)?(?:[$¥€£]\s*)?[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(.*)$/;

export const IMPORT_VALUE_RANK_PREFIX_REGEX = /^[#＃]/;
