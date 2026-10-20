# ParkRight A2 fine-tuning results

Dataset `a2-sim-v1-b569da957c`; manifest `935f4108f4b1e00c17f71b090ac60f4ad38c86e1ec183b10bef121f2a4e976c3`. 
Selected epoch 4 by validation vehicle mAP@0.50:0.95. 
TEST was evaluated only after the model, checkpoint, mapping, preprocessing, thresholds, and ROI logic were frozen.

| Evaluation | Det P | Det R | AP50 | mAP50:95 | OCC P | OCC R | Space policy acc | UNCERTAIN | CPU mean ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Validation A2 | 0.9799 | 1.0000 | 0.9999 | 0.9741 | 0.9611 | 0.9888 | 0.9733 | 0.4642 | 1746.2 |
| TEST A0 | 0.0000 | 0.0000 | 0.0191 | 0.0118 | 0.0000 | 0.0000 | 0.4759 | 1.0000 | 105.2 |
| TEST A2 | 0.9609 | 0.9922 | 0.9899 | 0.9578 | 0.9603 | 0.9877 | 0.9721 | 0.4610 | 1873.0 |

`Space policy acc` treats correct OCCUPIED calls and policy-safe UNCERTAIN calls on empty spaces as correct because OPEN remained disabled. Production false OPEN is zero by construction. The machine-readable report includes the separately labeled naive absence-as-OPEN diagnostic.

## Held-out A2 breakdowns

### environment

| Group | Det P | Det R | AP50 | mAP50:95 | OCC P | OCC R | Space policy acc | UNCERTAIN | CPU mean ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| clear_day | 0.9771 | 0.9903 | 0.9898 | 0.9608 | 0.9900 | 0.9822 | 0.9858 | 0.4898 | — |
| dusk | 0.9427 | 0.9875 | 0.9880 | 0.9375 | 0.8662 | 0.9875 | 0.9113 | 0.3871 | — |
| night | 0.9478 | 0.9925 | 0.9899 | 0.9634 | 0.9865 | 0.9846 | 0.9851 | 0.4841 | — |
| overcast | 0.9782 | 1.0000 | 0.9998 | 0.9723 | 1.0000 | 1.0000 | 1.0000 | 0.4658 | — |

### subset

| Group | Det P | Det R | AP50 | mAP50:95 | OCC P | OCC R | Space policy acc | UNCERTAIN | CPU mean ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| robustness | 0.9153 | 0.9757 | 0.9770 | 0.9340 | 0.9982 | 0.9757 | 0.9844 | 0.4135 | — |
| standard | 0.9832 | 1.0000 | 1.0000 | 0.9712 | 0.9435 | 0.9934 | 0.9673 | 0.4796 | — |

### kind

| Group | Det P | Det R | AP50 | mAP50:95 | OCC P | OCC R | Space policy acc | UNCERTAIN | CPU mean ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| settled | 0.9553 | 0.9911 | 0.9897 | 0.9554 | 0.9618 | 0.9911 | 0.9740 | 0.4460 | — |
| transition | 1.0000 | 1.0000 | 1.0000 | 0.9745 | 0.9488 | 0.9623 | 0.9604 | 0.5521 | — |

### family

| Group | Det P | Det R | AP50 | mAP50:95 | OCC P | OCC R | Space policy acc | UNCERTAIN | CPU mean ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| occlusion | 0.9744 | 1.0000 | 1.0000 | 0.9527 | 0.8444 | 1.0000 | 0.9125 | 0.4375 | — |
| robust_large_vehicles | 0.8859 | 1.0000 | 0.9985 | 0.9539 | 1.0000 | 1.0000 | 1.0000 | 0.3125 | — |
| robust_pillar | 0.9059 | 0.9167 | 0.9481 | 0.8753 | 0.9935 | 0.9167 | 0.9479 | 0.4618 | — |
| robust_row_pattern | 0.9863 | 1.0000 | 1.0000 | 0.9795 | 1.0000 | 1.0000 | 1.0000 | 0.5000 | — |
| settled | 0.9800 | 1.0000 | 1.0000 | 0.9737 | 0.9567 | 1.0000 | 0.9762 | 0.4500 | — |
| static_empty | 0.0000 | 0.0000 | N/A | N/A | 0.0000 | 0.0000 | 1.0000 | 1.0000 | — |
| transition | 1.0000 | 1.0000 | 1.0000 | 0.9745 | 0.9488 | 0.9623 | 0.9604 | 0.5521 | — |

## Protocol note

Before tooling existed, a schema probe displayed the first manifest record (static-empty test metadata, no test image). It was quarantined and did not influence configuration or checkpoint selection.

No post-TEST tuning was performed. Further model changes require a new held-out test set.
