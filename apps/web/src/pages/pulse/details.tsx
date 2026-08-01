import type { NextPageWithLayout } from "../_app";
import { getDashboardLayout } from "~/components/Dashboard";
import Popup from "~/components/Popup";
import PulseDetailsView from "~/views/pulse/details";

const PulseDetailsPage: NextPageWithLayout = () => {
  return (
    <>
      <PulseDetailsView />
      <Popup />
    </>
  );
};

PulseDetailsPage.getLayout = (page) => getDashboardLayout(page);

export default PulseDetailsPage;
