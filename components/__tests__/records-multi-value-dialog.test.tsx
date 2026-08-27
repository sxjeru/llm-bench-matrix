import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import {
  RecordsMultiValueDialog,
  type MultiValueRecordDraft
} from "@/components/admin-console/views/records/multi-value-dialog";
import type { AdminRecordCell, AdminRecordMatrixBenchmark, AdminRecordMatrixModel } from "@/components/admin-console/types";

const model: AdminRecordMatrixModel = {
  modelId: 1,
  modelName: "Model A",
  providerId: 1,
  providerName: "OpenAI",
  providerDisplayName: "OpenAI",
  recordCount: 2
};

const benchmark: AdminRecordMatrixBenchmark = {
  benchmarkId: 11,
  benchmarkName: "Bench-1",
  benchmarkType: "Type-A",
  unit: "%",
  higherIsBetter: true,
  modalities: ["Text"],
  recordCount: 2
};

const cell: AdminRecordCell = {
  modelId: 1,
  benchmarkId: 11,
  recordId: 101,
  recordIds: [101, 102],
  recordCount: 2,
  valueRaw: "77",
  valueNum: 77,
  valueNum2: null,
  valueNote: "latest",
  source: "text:new",
  benchTime: "2026-04-01T00:00:00.000Z",
  records: [
    {
      id: 101,
      valueRaw: "77",
      valueNum: 77,
      valueNum2: null,
      valueNote: "latest",
      source: "text:new",
      benchTime: "2026-04-01T00:00:00.000Z"
    },
    {
      id: 102,
      valueRaw: "66",
      valueNum: 66,
      valueNum2: null,
      valueNote: null,
      source: null,
      benchTime: "2026-03-01T00:00:00.000Z"
    }
  ]
};

describe("RecordsMultiValueDialog", () => {
  test("列出全部记录并只提交被修改的记录", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    renderDialog(onSave);

    expect(screen.getByRole("dialog", { name: "编辑单元格内的 2 条记录" })).toBeInTheDocument();
    expect(screen.getByLabelText("记录 101 原始值")).toHaveValue("77");
    expect(screen.getByLabelText("记录 102 原始值")).toHaveValue("66");

    await user.clear(screen.getByLabelText("记录 101 原始值"));
    await user.type(screen.getByLabelText("记录 101 原始值"), "88");
    await user.click(screen.getByRole("button", { name: "保存全部记录" }));

    expect(onSave).toHaveBeenCalledWith([
      expect.objectContaining({ id: 101, valueRaw: "88", isDeleted: false })
    ]);
  });

  test("标记删除后只提交该条删除，并禁用其输入", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    renderDialog(onSave);

    await user.click(screen.getAllByRole("button", { name: "删除此条" })[1]!);

    expect(screen.getByLabelText("记录 102 原始值")).toBeDisabled();
    expect(screen.getByLabelText("记录 102 测试时间")).toBeDisabled();
    expect(screen.getByRole("button", { name: "撤销删除" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "保存全部记录" }));

    expect(onSave).toHaveBeenCalledWith([
      expect.objectContaining({ id: 102, valueRaw: "66", isDeleted: true })
    ]);
  });

  test("未删除记录的空值会阻止保存", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    renderDialog(onSave);

    await user.clear(screen.getByLabelText("记录 101 原始值"));

    expect(screen.getByText("未删除的记录必须填写原始值和测试时间。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存全部记录" })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });
});

function renderDialog(onSave: (records: MultiValueRecordDraft[]) => void) {
  return render(
    <RecordsMultiValueDialog
      cell={cell}
      model={model}
      benchmark={benchmark}
      busy={false}
      onClose={vi.fn()}
      onSave={onSave}
    />
  );
}
