import type { NextPageWithLayout } from "~/pages/_app";
import { getDashboardLayout } from "~/components/Dashboard";
import Popup from "~/components/Popup";
import { SettingsLayout } from "~/components/SettingsLayout";
import WhitelabelSettings from "~/views/settings/WhitelabelSettings";

const WhitelabelSettingsPage: NextPageWithLayout = () => {
  return (
    <SettingsLayout currentTab="whitelabel">
      <WhitelabelSettings />
      <Popup />
    </SettingsLayout>
  );
};

WhitelabelSettingsPage.getLayout = (page) => getDashboardLayout(page);

export default WhitelabelSettingsPage;
