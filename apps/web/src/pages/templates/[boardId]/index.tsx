import { useRouter } from "next/router";

import type { NextPageWithLayout } from "~/pages/_app";
import { getDashboardLayout } from "~/components/Dashboard";
import Popup from "~/components/Popup";
import { getBoardRoutePublicId } from "~/utils/board-navigation";
import BoardView from "~/views/board";

const TemplatePage: NextPageWithLayout = () => {
  const router = useRouter();
  const boardPublicId = getBoardRoutePublicId(router.query.boardId);

  return (
    <>
      <BoardView key={boardPublicId ?? "loading"} isTemplate />
      <Popup />
    </>
  );
};

TemplatePage.getLayout = (page) => getDashboardLayout(page);

export default TemplatePage;
