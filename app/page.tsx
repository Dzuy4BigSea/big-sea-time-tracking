import { redirect } from 'next/navigation'

export default function Home() {
  // First real screen is Invoices; land there for now.
  redirect('/invoices')
}
