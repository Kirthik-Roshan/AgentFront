import { AppShell } from './components/AppShell'
import { useDemo } from './hooks/useDemo'
import { AgreementView } from './views/AgreementView'
import { BuildView } from './views/BuildView'
import { DeliverView } from './views/DeliverView'
import { DiscoverView } from './views/DiscoverView'
import { OutreachView } from './views/OutreachView'
import { QualifyView } from './views/QualifyView'
import { RequirementsView } from './views/RequirementsView'

export default function App() {
  const { stage } = useDemo()
  const views = [<DiscoverView/>, <QualifyView/>, <OutreachView/>, <RequirementsView/>, <AgreementView/>, <BuildView/>, <DeliverView/>]
  return <AppShell>{views[stage - 1]}</AppShell>
}
