import type { NextPageWithLayout } from "./_app";
import { getDashboardLayout } from "~/components/Dashboard";
import Popup from "~/components/Popup";
import PulseView from "~/views/pulse";

const PulsePage: NextPageWithLayout = () => {
  return (
    <>
      <PulseView />
      <Popup />
    </>
  );
};

PulsePage.getLayout = (page) => getDashboardLayout(page);

export default PulsePage;
