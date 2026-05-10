import { DRAG_BAR_HEIGHT } from "../../../shared/constants";

export default function WindowDragBar() {
  return <div className="drag-region" style={{ height: DRAG_BAR_HEIGHT, flexShrink: 0 }} />;
}
