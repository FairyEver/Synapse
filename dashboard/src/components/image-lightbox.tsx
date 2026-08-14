import {
  createImageLightbox,
  type ImageLightboxItem,
  type ImageLightboxPreview,
  type ImageLightboxProps,
} from "@synapse/ui"

import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

const ImageLightbox = createImageLightbox({
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
})

export {
  ImageLightbox,
  type ImageLightboxItem,
  type ImageLightboxPreview,
  type ImageLightboxProps,
}
