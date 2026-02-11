import { ReloadIcon } from "@radix-ui/react-icons"

import { Button } from "@/components/ui/button"

export default function ButtonLoading() {
  return (
    <Button disabled>
      <ReloadIcon className="mr-2 h-4 w-4 animate-spin" />
      Please wait
    </Button>
  )
}
