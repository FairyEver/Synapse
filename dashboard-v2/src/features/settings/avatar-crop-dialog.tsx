import AvatarEditor, { type AvatarEditorRef } from 'react-avatar-editor';
import { Button, Label, Modal, Slider } from '@heroui/react';
import { useEffect, useRef, useState } from 'react';

type AvatarCropDialogProps = {
  file: File | null;
  isUploading: boolean;
  onCancel: () => void;
  onCropped: (blob: Blob) => Promise<void>;
};

export function AvatarCropDialog({ file, isUploading, onCancel, onCropped }: AvatarCropDialogProps) {
  const editorRef = useRef<AvatarEditorRef>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0.5, y: 0.5 });

  useEffect(() => {
    if (!file) {
      setImageSrc(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setImageSrc(url);
    setScale(1);
    setPosition({ x: 0.5, y: 0.5 });
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const handleWheel = (event: React.WheelEvent) => {
    event.preventDefault();
    if (event.ctrlKey) {
      setScale((current) => Math.min(4, Math.max(1, current + (event.deltaY > 0 ? -0.05 : 0.05))));
      return;
    }
    const sensitivity = 0.002;
    setPosition((current) => ({
      x: Math.min(1, Math.max(0, current.x + event.deltaX * sensitivity)),
      y: Math.min(1, Math.max(0, current.y + event.deltaY * sensitivity)),
    }));
  };

  const handleConfirm = async () => {
    const canvas = editorRef.current?.getImageScaledToCanvas();
    if (!canvas || isUploading) return;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (blob) await onCropped(blob);
  };

  return (
    <Modal.Backdrop isOpen={Boolean(file)} onOpenChange={(open) => !open && !isUploading && onCancel()}>
      <Modal.Container placement="center">
        <Modal.Dialog className="sm:max-w-[360px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>裁剪头像</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <p className="text-sm text-muted">拖动或双指调整位置，捏合缩放图片</p>
            {imageSrc ? (
              <div className="flex flex-col items-center gap-4">
                <div className="overflow-hidden rounded-lg" onWheel={handleWheel}>
                  <AvatarEditor
                    ref={editorRef}
                    image={imageSrc}
                    width={256}
                    height={256}
                    border={0}
                    borderRadius={0}
                    scale={scale}
                    position={position}
                    onPositionChange={setPosition}
                    color={[0, 0, 0, 0.6]}
                  />
                </div>
                <Slider
                  className="w-full"
                  minValue={1}
                  maxValue={4}
                  step={0.01}
                  value={scale}
                  onChange={(value) => {
                    if (typeof value === 'number') setScale(value);
                  }}
                >
                  <div className="flex items-center justify-between">
                    <Label>缩放</Label>
                    <Slider.Output />
                  </div>
                  <Slider.Track>
                    <Slider.Fill />
                    <Slider.Thumb />
                  </Slider.Track>
                </Slider>
              </div>
            ) : null}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" isDisabled={isUploading} onPress={onCancel}>
              取消
            </Button>
            <Button isPending={isUploading} onPress={() => void handleConfirm()}>
              使用头像
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
